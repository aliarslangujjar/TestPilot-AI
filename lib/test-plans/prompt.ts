import { AI_MODEL_RATES_USD_PER_MTOK, type AIProvider } from "@schemas/ai";
import type { PriorityStrategy, TestPlanSourceKind, TestType } from "@schemas/test-plan";
import { TEST_TYPE_LABELS } from "@schemas/test-plan";

/**
 * Shared prompt construction for test-plan generation. No secrets here —
 * safe to import from client components (for usage estimates).
 */

export const TEST_PLAN_SYSTEM_PROMPT = `You are a senior QA analyst writing manual test cases. Output JSON only, matching the provided schema exactly.

Rules:
- Each case needs: title (specific and unique), objective (one sentence stating what the case verifies), preconditions, steps (ordered; every step has an action and its own expected result), expectedResults (observable outcomes only — never write vague phrases like "works correctly", "loads successfully", or "as expected"; state exactly what the tester should observe), priority, coverage (exactly one of "positive", "negative", or "boundary"), and assumptions (list anything you assumed that was not stated in the source; use an empty array when nothing was assumed).
- Do not invent features that are not in the source text; record guesses as assumptions instead.
- These are planned test cases, not executed ones. Never claim they have been run or imply any coverage has been achieved.`;

const SOURCE_LABELS: Record<TestPlanSourceKind, string> = {
  user_story: "User Story",
  acceptance_criteria: "Acceptance Criteria",
  testing_request: "Testing Request",
};

export function buildTestPlanUserPrompt(args: {
  sourceKind: TestPlanSourceKind;
  sourceText: string;
  maxCases: number;
  includeNegative: boolean;
  includeBoundary: boolean;
}): string {
  const label = SOURCE_LABELS[args.sourceKind];
  const lines = [
    `Generate at most ${args.maxCases} test cases from the following ${label.toLowerCase()}.`,
    "",
    "Include positive cases covering the main flows.",
  ];
  lines.push(
    args.includeNegative
      ? "Include negative cases (invalid input, unauthorized actions, error handling)."
      : "Do not include negative cases.",
  );
  lines.push(
    args.includeBoundary
      ? "Include boundary cases (minimum/maximum values, limits, edge values)."
      : "Do not include boundary cases.",
  );
  lines.push(
    "",
    "Order cases by importance, most critical first.",
    "",
    `<${label}>`,
    args.sourceText,
    `</${label}>`,
  );
  return lines.join("\n");
}

export function estimateInputChars(sourceText: string): number {
  return TEST_PLAN_SYSTEM_PROMPT.length + sourceText.length + 400; // prompt template overhead
}

/** Rough token math (~4 chars per token). Displayed as an approximation. */
export function estimateTestPlanUsage(
  sourceText: string,
  maxCases: number,
  provider: AIProvider,
): { inputTokens: number; outputTokens: number; costUsd: number } {
  const inputTokens = Math.ceil(estimateInputChars(sourceText) / 4);
  const outputTokens = maxCases * 260;
  const rates = AI_MODEL_RATES_USD_PER_MTOK[provider];
  const costUsd = (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  return { inputTokens, outputTokens, costUsd: Math.round(costUsd * 10000) / 10000 };
}

/**
 * Stored-plan generation: template-guided, user-controlled test types,
 * coverage areas, and priority strategy. Output shape matches
 * generatedPlanSchema (cases carry testType + area).
 */

export const STORED_PLAN_SYSTEM_PROMPT = `You are a senior QA analyst writing a manual test plan. Output JSON only, matching the provided schema exactly.

Rules:
- Each case needs: title (specific and unique), objective (one sentence stating what the case verifies), preconditions, steps (ordered; every step has an action and its own expected result), expectedResults (observable outcomes only — never write vague phrases like "works correctly", "loads successfully", or "as expected"; state exactly what the tester should observe), priority, coverage (exactly one of "positive", "negative", or "boundary" — use "negative" for negative-type cases, "boundary" for boundary-type cases, "positive" otherwise), testType (exactly one of the requested test types), area (exactly one of the requested coverage areas), and assumptions (list anything you assumed that was not stated in the source; use an empty array when nothing was assumed).
- Only use test types and coverage areas from the provided lists.
- Do not invent features that are not in the source text; record guesses as assumptions instead.
- These are planned test cases, not executed ones. Never claim they have been run or imply any coverage has been achieved.`;

const STRATEGY_GUIDANCE: Record<PriorityStrategy, string> = {
  risk_first:
    "Assign high/critical priority to failure modes, error paths, and security-relevant cases; routine happy paths get medium or low.",
  balanced:
    "Distribute priorities evenly across the plan; reserve high/critical for genuinely risky or business-critical cases.",
  happy_path_first:
    "Assign high priority to the main happy paths first; edge and negative cases get medium or low unless they guard critical flows.",
};

export function buildStoredPlanUserPrompt(args: {
  sourceKind: TestPlanSourceKind;
  sourceText: string;
  maxCases: number;
  testTypes: TestType[];
  coverageAreas: string[];
  priorityStrategy: PriorityStrategy;
  templateGuidance: string;
}): string {
  const label = SOURCE_LABELS[args.sourceKind];
  const lines = [
    `Generate at most ${args.maxCases} test cases from the following ${label.toLowerCase()}.`,
    "",
    `Use only these test types: ${args.testTypes.map((t) => TEST_TYPE_LABELS[t]).join(", ")}.`,
    `Use only these coverage areas: ${args.coverageAreas.join("; ")}.`,
    "",
    `Priority strategy: ${STRATEGY_GUIDANCE[args.priorityStrategy]}`,
    "",
    `Template guidance: ${args.templateGuidance}`,
    "",
    "Order cases by importance, most critical first.",
    "",
    `<${label}>`,
    args.sourceText,
    `</${label}>`,
  ];
  return lines.join("\n");
}
