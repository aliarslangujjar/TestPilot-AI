import { z } from "zod";

/** AI-assisted test-plan generation: request and strictly-validated output. */

export const testPlanSourceKindSchema = z.enum([
  "user_story",
  "acceptance_criteria",
  "testing_request",
]);

export type TestPlanSourceKind = z.infer<typeof testPlanSourceKindSchema>;

export const TEST_PLAN_SOURCE_LABELS: Record<TestPlanSourceKind, string> = {
  user_story: "User story",
  acceptance_criteria: "Acceptance criteria",
  testing_request: "Testing request",
};

export const testPlanRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  sourceKind: testPlanSourceKindSchema,
  sourceText: z
    .string()
    .trim()
    .min(20, "Describe the story, criteria, or request in at least 20 characters.")
    .max(8000, "Source text must be at most 8000 characters."),
  maxCases: z.number().int().min(1).max(20).default(8),
  includeNegative: z.boolean().default(true),
  includeBoundary: z.boolean().default(true),
});

export type TestPlanRequest = z.infer<typeof testPlanRequestSchema>;

export const plannedStepSchema = z.object({
  action: z.string().trim().min(1).max(500),
  expected: z.string().trim().min(1).max(500),
});

export const plannedCaseSchema = z.object({
  title: z.string().trim().min(2).max(200),
  /** One sentence: what this case verifies. */
  objective: z.string().trim().min(1).max(500),
  preconditions: z.string().trim().max(2000).default(""),
  steps: z.array(plannedStepSchema).min(1).max(30),
  expectedResults: z.string().trim().min(1).max(2000),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  coverage: z.enum(["positive", "negative", "boundary"]),
  /** Anything the model assumed — surfaced for human verification. */
  assumptions: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});

export type PlannedCase = z.infer<typeof testPlanSchema>["cases"][number];

export const testPlanSchema = z.object({
  cases: z.array(plannedCaseSchema).min(1).max(20),
  /** One-paragraph summary of the plan's coverage. */
  summary: z.string().trim().min(1).max(1000),
});

export type TestPlan = z.infer<typeof testPlanSchema>;

export const planEstimateSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
});

export type PlanEstimate = z.infer<typeof planEstimateSchema>;
