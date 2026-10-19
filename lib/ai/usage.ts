import { createAdminClient } from "@/lib/supabase/admin";
import type { AIConfig } from "@schemas/ai";

import { AIServiceError } from "./errors";

/**
 * Per-workspace AI quotas + usage logging, backed by public.ai_usage
 * (one row per workspace per calendar day).
 *
 * Writes go through the service-role client, so every function here
 * validates the workspace id itself (defense in depth — RLS is bypassed).
 * Quotas are soft: two concurrent requests can both pass the check. That is
 * acceptable for cost guardrails; it is documented, not a bug.
 */

export interface AIUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertWorkspaceId(workspaceId: string): void {
  if (!uuidPattern.test(workspaceId)) {
    throw new AIServiceError("AI_INPUT_TOO_LONG", "Invalid workspace id.");
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayUsage(workspaceId: string): Promise<AIUsage> {
  assertWorkspaceId(workspaceId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_usage")
    .select("request_count,input_tokens,output_tokens")
    .eq("workspace_id", workspaceId)
    .eq("period", todayKey())
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read AI usage: ${error.message}`);
  }
  return {
    requests: data?.request_count ?? 0,
    inputTokens: data?.input_tokens ?? 0,
    outputTokens: data?.output_tokens ?? 0,
  };
}

/** Throw AI_QUOTA_EXCEEDED when today's usage already hit a daily limit. */
export async function checkQuota(workspaceId: string, config: AIConfig): Promise<void> {
  const usage = await getTodayUsage(workspaceId);
  if (usage.requests >= config.AI_DAILY_REQUEST_LIMIT) {
    throw new AIServiceError(
      "AI_QUOTA_EXCEEDED",
      `This workspace has used its daily AI request allowance (${config.AI_DAILY_REQUEST_LIMIT} requests). Try again tomorrow.`,
    );
  }
  if (usage.inputTokens + usage.outputTokens >= config.AI_DAILY_TOKEN_LIMIT) {
    throw new AIServiceError(
      "AI_QUOTA_EXCEEDED",
      `This workspace has used its daily AI token allowance (${config.AI_DAILY_TOKEN_LIMIT} tokens). Try again tomorrow.`,
    );
  }
}

/** Record one completed request against today's row (upsert = create-or-bump). */
export async function logUsage(
  workspaceId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  assertWorkspaceId(workspaceId);
  const current = await getTodayUsage(workspaceId);
  const admin = createAdminClient();
  const { error } = await admin.from("ai_usage").upsert(
    {
      workspace_id: workspaceId,
      period: todayKey(),
      request_count: current.requests + 1,
      input_tokens: current.inputTokens + Math.max(0, Math.round(inputTokens)),
      output_tokens: current.outputTokens + Math.max(0, Math.round(outputTokens)),
    },
    { onConflict: "workspace_id,period" },
  );
  if (error) {
    throw new Error(`Failed to log AI usage: ${error.message}`);
  }
}
