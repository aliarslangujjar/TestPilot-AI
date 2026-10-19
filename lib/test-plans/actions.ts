"use server";

import type { ActionResult } from "@/lib/action-result";
import { AIServiceError, type AIErrorCode } from "@/lib/ai/errors";
import { generateStructured, getAIStatus } from "@/lib/ai/service";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import {
  testPlanRequestSchema,
  testPlanSchema,
  type PlanEstimate,
  type TestPlanRequest,
} from "@schemas/test-plan";
import type { GeneratedCase } from "@schemas/ai-review";

import { TEST_PLAN_SYSTEM_PROMPT, buildTestPlanUserPrompt, estimateTestPlanUsage } from "./prompt";

/**
 * AI-assisted test-plan generation.
 *
 * Takes a user story, acceptance criteria, or testing request and returns
 * typed test-case drafts (objectives, preconditions, numbered steps,
 * expected results, priorities, coverage classes, assumptions).
 *
 * Nothing is persisted here and nothing is claimed as executed: the drafts
 * go to the human review gate (ReviewWorkspace → saveReviewedCases, which
 * stores them as drafts only).
 */

const NO_ACCESS = "You don't have access to this workspace.";
const UNEXPECTED = "Something went wrong. Please try again.";

export interface GeneratedTestPlan {
  cases: GeneratedCase[];
  summary: string;
  estimate: PlanEstimate;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export type GenerateTestPlanResult = ActionResult<GeneratedTestPlan> & {
  code?: AIErrorCode;
};

function toActionError(error: unknown): { error: string; code?: AIErrorCode } {
  if (error instanceof AIServiceError) return { error: error.message, code: error.code };
  if (error instanceof WorkspaceAccessDeniedError) return { error: NO_ACCESS };
  return { error: UNEXPECTED };
}

/** Strict post-validation beyond the zod schema parse. */
function validatePlanOrThrow(plan: { cases: Array<{ coverage: string }> }, req: TestPlanRequest) {
  const fail = (message: string) => {
    throw new AIServiceError("AI_INVALID_RESPONSE", message);
  };
  if (plan.cases.length === 0) fail("The AI returned no test cases.");
  if (plan.cases.length > req.maxCases) {
    fail(`The AI returned ${plan.cases.length} cases (max ${req.maxCases}).`);
  }
  const kinds = new Set(plan.cases.map((c) => c.coverage));
  if (req.includeNegative && !kinds.has("negative")) {
    fail("The AI returned no negative cases although they were requested.");
  }
  if (req.includeBoundary && !kinds.has("boundary")) {
    fail("The AI returned no boundary cases although they were requested.");
  }
}

export async function generateTestPlan(input: unknown): Promise<GenerateTestPlanResult> {
  const parsed = testPlanRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const req = parsed.data;

  try {
    await requireWorkspaceClient(req.workspaceId);

    const status = await getAIStatus();
    const estimate = estimateTestPlanUsage(req.sourceText, req.maxCases, status.provider);

    const { data: plan, usage } = await generateStructured({
      workspaceId: req.workspaceId,
      system: TEST_PLAN_SYSTEM_PROMPT,
      prompt: buildTestPlanUserPrompt(req),
      schema: testPlanSchema,
      label: "test-plan",
    });

    validatePlanOrThrow(plan, req);

    const cases: GeneratedCase[] = plan.cases.map((c) => ({
      tempId: crypto.randomUUID(),
      title: c.title,
      description: "",
      preconditions: c.preconditions,
      steps: c.steps,
      expectedResults: c.expectedResults,
      priority: c.priority,
      tags: [c.coverage],
      objective: c.objective,
      coverage: c.coverage,
      assumptions: c.assumptions,
    }));

    return {
      ok: true,
      data: { cases, summary: plan.summary, estimate, usage, model: status.model },
    };
  } catch (error) {
    const { error: message, code } = toActionError(error);
    return { ok: false, error: message, code };
  }
}
