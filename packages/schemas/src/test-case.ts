/**
 * Shared test-case validation schemas. Used by the test-case server actions
 * (authoritative) and forms (instant feedback) so the rules can't drift.
 *
 * Steps are an ordered array of { action, expected } objects; the overall
 * pass criteria live in expectedResults. AI generation and browser
 * execution are deferred — these cases are manual.
 */
import { z } from "zod";

export const testCaseTitleSchema = z
  .string()
  .trim()
  .min(2, "Title must be at least 2 characters.")
  .max(200, "Title must be at most 200 characters.");

export const testCaseDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be at most 2000 characters.")
  .nullish();

export const testCasePreconditionsSchema = z
  .string()
  .trim()
  .max(2000, "Preconditions must be at most 2000 characters.")
  .nullish();

export const testCaseStepSchema = z.object({
  action: z
    .string()
    .trim()
    .min(1, "Step action cannot be empty.")
    .max(2000, "Step action must be at most 2000 characters."),
  expected: z
    .string()
    .trim()
    .max(2000, "Step expectation must be at most 2000 characters.")
    .nullish(),
});

export const testCaseStepsSchema = z
  .array(testCaseStepSchema)
  .max(100, "At most 100 steps per test case.");

export const testCaseExpectedResultsSchema = z
  .string()
  .trim()
  .max(2000, "Expected results must be at most 2000 characters.")
  .nullish();

export const testCasePrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const testCaseTagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Tags cannot be empty.")
      .max(50, "Tags must be at most 50 characters."),
  )
  .max(20, "At most 20 tags per test case.");

export const testCaseStatusSchema = z.enum(["draft", "active"]);

export const testCaseObjectiveSchema = z
  .string()
  .trim()
  .max(500, "Objective must be at most 500 characters.")
  .nullish();

export const testCaseCoverageSchema = z.enum(["positive", "negative", "boundary"]);

export const testCaseAssumptionsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Assumptions cannot be empty.")
      .max(200, "Each assumption must be at most 200 characters."),
  )
  .max(20, "At most 20 assumptions per test case.");

export const createTestCaseSchema = z.object({
  title: testCaseTitleSchema,
  description: testCaseDescriptionSchema,
  preconditions: testCasePreconditionsSchema,
  steps: testCaseStepsSchema.default([]),
  expectedResults: testCaseExpectedResultsSchema,
  priority: testCasePrioritySchema.default("medium"),
  tags: testCaseTagsSchema.default([]),
  status: testCaseStatusSchema.default("draft"),
  objective: testCaseObjectiveSchema,
  coverage: testCaseCoverageSchema.nullish(),
  assumptions: testCaseAssumptionsSchema.default([]),
});

/** Editing a test case uses the same shape as creating one. */
export const updateTestCaseSchema = createTestCaseSchema;

/** API/database row shape (camelCase) returned by the test-case actions. */
export const testCaseSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  suiteId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  preconditions: z.string().nullable(),
  steps: z.array(z.object({ action: z.string(), expected: z.string().nullable() })),
  expectedResults: z.string().nullable(),
  priority: testCasePrioritySchema,
  tags: z.array(z.string()),
  status: testCaseStatusSchema,
  objective: z.string().nullable(),
  coverage: testCaseCoverageSchema.nullable(),
  assumptions: z.array(z.string()),
  isArchived: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateTestCaseInput = z.input<typeof createTestCaseSchema>;
export type UpdateTestCaseInput = z.input<typeof updateTestCaseSchema>;
export type TestCaseStep = z.infer<typeof testCaseStepSchema>;
export type TestCase = z.infer<typeof testCaseSchema>;
