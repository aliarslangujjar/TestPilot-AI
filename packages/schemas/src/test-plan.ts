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

/**
 * Automated test-plan generation with templates: request and
 * strictly-validated stored output. A stored plan is the seed for
 * converting into a suite of draft test cases.
 */

export const testTypeSchema = z.enum([
  "functional",
  "negative",
  "boundary",
  "security",
  "accessibility",
  "performance",
]);

export type TestType = z.infer<typeof testTypeSchema>;

export const TEST_TYPE_LABELS: Record<TestType, string> = {
  functional: "Functional",
  negative: "Negative",
  boundary: "Boundary",
  security: "Security",
  accessibility: "Accessibility",
  performance: "Performance",
};

export const priorityStrategySchema = z.enum(["risk_first", "balanced", "happy_path_first"]);

export type PriorityStrategy = z.infer<typeof priorityStrategySchema>;

export const PRIORITY_STRATEGY_LABELS: Record<PriorityStrategy, string> = {
  risk_first: "Risk-first (prioritize failure modes)",
  balanced: "Balanced coverage",
  happy_path_first: "Happy-path first",
};

export const planGenerationRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  /** Display name of the plan. */
  name: z.string().trim().min(2).max(120),
  sourceKind: testPlanSourceKindSchema,
  sourceText: z
    .string()
    .trim()
    .min(20, "Describe the story, criteria, or request in at least 20 characters.")
    .max(8000, "Source text must be at most 8000 characters."),
  /** Template registry key, e.g. "ecommerce". Validated against the registry in the action. */
  templateKey: z.string().trim().min(1).max(60),
  testTypes: z.array(testTypeSchema).min(1).max(6),
  coverageAreas: z
    .array(z.string().trim().min(1).max(60))
    .min(1, "Pick at least one coverage area.")
    .max(10),
  priorityStrategy: priorityStrategySchema,
  maxCases: z.number().int().min(1).max(30).default(12),
});

export type PlanGenerationRequest = z.infer<typeof planGenerationRequestSchema>;

export const generatedPlanCaseSchema = plannedCaseSchema.extend({
  testType: testTypeSchema,
  /** Coverage area this case belongs to, from the request's coverageAreas. */
  area: z.string().trim().min(1).max(60),
});

export type GeneratedPlanCase = z.infer<typeof generatedPlanCaseSchema>;

export const generatedPlanSchema = z.object({
  cases: z.array(generatedPlanCaseSchema).min(1).max(30),
  summary: z.string().trim().min(1).max(1000),
});

export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;

export const testPlanStatusSchema = z.enum(["draft", "converted"]);

export type TestPlanStatus = z.infer<typeof testPlanStatusSchema>;

/** API/database shape of a stored test plan (camelCase). */
export const storedTestPlanSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  templateKey: z.string(),
  sourceKind: testPlanSourceKindSchema,
  sourceText: z.string(),
  settings: z.object({
    testTypes: z.array(testTypeSchema),
    coverageAreas: z.array(z.string()),
    priorityStrategy: priorityStrategySchema,
    maxCases: z.number().int(),
  }),
  plan: generatedPlanSchema,
  model: z.string().nullable(),
  status: testPlanStatusSchema,
  suiteId: z.uuid().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StoredTestPlan = z.infer<typeof storedTestPlanSchema>;
