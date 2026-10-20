import type { ExecutionStatus } from "@schemas/test-run";

/**
 * Rollup precedence for an automated run's overall execution status:
 * running > queued > failed > timed_out > cancelled > passed.
 *
 * Lives outside any "use server" module so client components may import
 * server actions from lib/test-runs/automated.ts without tripping
 * Next's "all exports must be async" rule for action files.
 */
export function rollupExecutionStatus(statuses: ExecutionStatus[]): ExecutionStatus {
  if (statuses.includes("running")) return "running";
  if (statuses.includes("queued")) return "queued";
  if (statuses.length === 0) return "queued";
  if (statuses.every((s) => s === "passed")) return "passed";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("timed_out")) return "timed_out";
  return "cancelled";
}
