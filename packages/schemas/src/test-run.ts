import { z } from "zod";

/** Shared test-run validation. */

export const runNameSchema = z
  .string()
  .trim()
  .min(2, "Run name must be at least 2 characters.")
  .max(100, "Run name must be 100 characters or fewer.");

export const runSourceSchema = z.enum(["manual", "automated"]);
export type RunSource = z.infer<typeof runSourceSchema>;

export const runStatusSchema = z.enum(["in_progress", "completed"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const resultOutcomeSchema = z.enum(["unexecuted", "pass", "fail", "blocked", "skipped"]);
export type ResultOutcome = z.infer<typeof resultOutcomeSchema>;

/**
 * Automation lifecycle for automated runs and their results, persisted
 * separately from the manual run status. `passed` is only ever set from
 * validated worker evidence (see lib/test-runs/automated.ts).
 */
export const executionStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "timed_out",
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/** Frozen copy of a test case taken when the run is created. */
export const caseSnapshotSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  preconditions: z.string().nullable(),
  steps: z.array(z.object({ action: z.string(), expected: z.string().nullable() })),
  expectedResults: z.string().nullable(),
  priority: z.string(),
  tags: z.array(z.string()),
  caseStatus: z.string(),
});
export type CaseSnapshot = z.infer<typeof caseSnapshotSchema>;

const uuidSchema = z.string().uuid();

export const createRunSchema = z.object({
  name: runNameSchema,
  suiteId: uuidSchema.nullish(),
  testCaseIds: z
    .array(uuidSchema)
    .min(1, "Pick at least one test case.")
    .max(500, "A run can include at most 500 test cases."),
  notes: z.string().trim().max(2000).nullish(),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const updateResultSchema = z.object({
  outcome: resultOutcomeSchema,
  notes: z.string().trim().max(2000, "Notes must be 2000 characters or fewer.").nullish(),
});
export type UpdateResultInput = z.infer<typeof updateResultSchema>;

export const runFilterSchema = z.object({
  status: runStatusSchema.nullish(),
});
export type RunFilter = z.infer<typeof runFilterSchema>;

export const testRunSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  suiteId: z.string().nullable(),
  name: z.string(),
  source: runSourceSchema,
  status: runStatusSchema,
  executionStatus: executionStatusSchema.nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type TestRun = z.infer<typeof testRunSchema>;

export const runSummarySchema = z.object({
  total: z.number(),
  unexecuted: z.number(),
  pass: z.number(),
  fail: z.number(),
  blocked: z.number(),
  skipped: z.number(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const runResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  workspaceId: z.string(),
  testCaseId: z.string().nullable(),
  snapshot: caseSnapshotSchema,
  outcome: resultOutcomeSchema,
  browserJobId: z.string().nullable(),
  executionStatus: executionStatusSchema.nullable(),
  artifacts: z.array(z.string()),
  notes: z.string().nullable(),
  executedBy: z.string().nullable(),
  executedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RunResult = z.infer<typeof runResultSchema>;
