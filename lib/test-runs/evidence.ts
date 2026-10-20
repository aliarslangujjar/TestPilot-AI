import { browserJobResultSchema } from "@schemas/browser-job";

/**
 * The evidence gate. A job may only mark a result passed when the worker
 * reports a succeeded job whose stored result parses against the result
 * schema, says "succeeded", covers exactly the plan's steps, and has
 * every step ok. Anything else is not a pass — no matter what the queue
 * row claims.
 *
 * Lives outside any "use server" module so client components may import
 * server actions from lib/test-runs/automated.ts without tripping
 * Next's "all exports must be async" rule for action files.
 */
export function validateWorkerEvidence(input: {
  jobStatus: string;
  result: unknown;
  planSteps: number;
}): boolean {
  if (input.jobStatus !== "succeeded") return false;
  if (input.planSteps < 1) return false;
  const parsed = browserJobResultSchema.safeParse(input.result);
  if (!parsed.success) return false;
  const result = parsed.data;
  if (result.status !== "succeeded") return false;
  if (result.steps.length !== input.planSteps) return false;
  return result.steps.every((step) => step.ok);
}
