"use server";

import { generateObject } from "ai";
import type { z } from "zod";

import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { getUsageLimits } from "@/lib/usage/limits";
import { releaseUsage, reserveUsage } from "@/lib/usage/usage";
import { structuredRequestSchema, type AIProvider } from "@schemas/ai";

import { AI_DEFAULT_MODELS, isAIEnabled, isDemoMode, loadAIConfig, resolveModel } from "./config";
import { buildDemoObject } from "./demo";
import { AIServiceError, toAIServiceError } from "./errors";
import { checkQuota, logUsage } from "./usage";

/**
 * Provider-independent AI service. Server-only.
 *
 * Every call flows through the same pipeline:
 *   validate input → prove workspace membership → load config →
 *   quota check → provider call (timeout + bounded retries) →
 *   zod-validated structured output → usage logging.
 *
 * SAFETY: `generateObject` is NEVER given `tools`. The model can only
 * produce text matching the caller's zod schema — it cannot execute code,
 * visit URLs, or perform any external action. API keys are read from server
 * env and never cross to the browser.
 */

export interface AIStatus {
  enabled: boolean;
  provider: AIProvider;
  model: string;
  demo: boolean;
}

/** Safe status for UI gating — contains no secrets. */
export async function getAIStatus(): Promise<AIStatus> {
  const config = loadAIConfig();
  const demo = isDemoMode();
  return {
    enabled: demo || isAIEnabled(config),
    provider: config.AI_PROVIDER,
    model: demo ? "demo" : (config.AI_MODEL ?? AI_DEFAULT_MODELS[config.AI_PROVIDER]),
    demo,
  };
}

export interface StructuredResult<T> {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Run a structured completion and return zod-validated data.
 *
 * Throws AIServiceError with a typed `code` on every failure mode —
 * callers switch on `error.code`, never on message text.
 */
export async function generateStructured<T>({
  workspaceId,
  system,
  prompt,
  schema,
  label,
}: {
  workspaceId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  label?: string;
}): Promise<StructuredResult<T>> {
  const parsed = structuredRequestSchema.safeParse({ workspaceId, system, prompt, label });
  if (!parsed.success) {
    throw new AIServiceError(
      "AI_INPUT_TOO_LONG",
      parsed.error.issues[0]?.message ?? "Invalid AI request input.",
    );
  }

  // Membership first: nothing below runs for non-members.
  await requireWorkspaceClient(workspaceId);

  let config;
  try {
    config = loadAIConfig();
  } catch {
    throw new AIServiceError("AI_NOT_CONFIGURED", "AI is not configured correctly.");
  }
  const demo = isDemoMode();
  if (!demo && !isAIEnabled(config)) {
    throw new AIServiceError(
      "AI_DISABLED",
      "AI features are not enabled — no API key is configured for the selected provider.",
    );
  }

  const maxChars = config.AI_MAX_INPUT_CHARS;
  if (prompt.length > maxChars || system.length > maxChars) {
    throw new AIServiceError(
      "AI_INPUT_TOO_LONG",
      `Input is too long (limit ${maxChars} characters per field).`,
    );
  }

  await checkQuota(workspaceId, config);

  // Free-plan period quota (atomic reservation — see lib/usage). The
  // reservation is released if the call then fails, so failed calls are
  // never billed against the plan.
  const planLimits = getUsageLimits();
  const reserved = await reserveUsage(workspaceId, { aiCalls: 1 });
  if (!reserved) {
    throw new AIServiceError(
      "AI_QUOTA_EXCEEDED",
      `Your workspace has reached the free plan's limit of ${planLimits.aiCalls} AI calls for this period. The limit resets next period.`,
    );
  }

  if (demo) {
    try {
      const data = buildDemoObject(schema);
      await logUsage(workspaceId, 0, 0);
      return { data, usage: { inputTokens: 0, outputTokens: 0 } };
    } catch {
      await releaseUsage(workspaceId, { aiCalls: 1 });
      throw new AIServiceError(
        "AI_INVALID_RESPONSE",
        "Demo mode could not produce a valid sample for this feature.",
      );
    }
  }

  const model = resolveModel(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.AI_TIMEOUT_MS);
  try {
    const result = await generateObject({
      model,
      schema,
      system,
      prompt,
      maxRetries: config.AI_MAX_RETRIES,
      abortSignal: controller.signal,
      // NOTE: no `tools` — the model returns text only. It cannot run code,
      // fetch URLs, or take any external action.
    });
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    await logUsage(workspaceId, inputTokens, outputTokens);
    return { data: result.object, usage: { inputTokens, outputTokens } };
  } catch (error) {
    await releaseUsage(workspaceId, { aiCalls: 1 });
    throw toAIServiceError(error);
  } finally {
    clearTimeout(timeout);
  }
}
