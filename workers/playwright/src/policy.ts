import type { JobRow, JobStore } from "./store.js";

/**
 * Worker-side policy checks. The web app validates on enqueue, but the
 * worker trusts nothing: membership can be revoked while a job sits
 * queued, and limits are re-checked immediately before execution.
 */

export type PolicyDecision = { ok: true } | { ok: false; reason: string };

/**
 * The job may run only if its workspace and project still exist, the
 * project still belongs to the workspace, and the enqueuing user is still
 * a member. Anything else fails the job with no retry — re-running would
 * fail the same way.
 */
export async function authorizeJob(store: JobStore, job: JobRow): Promise<PolicyDecision> {
  if (!(await store.workspaceExists(job.workspace_id))) {
    return { ok: false, reason: "workspace no longer exists" };
  }
  if (!(await store.projectInWorkspace(job.project_id, job.workspace_id))) {
    return { ok: false, reason: "project is not in the job's workspace" };
  }
  // Fail closed on a missing creator: every real enqueue path sets
  // created_by, so a null here means the row did not come through the
  // app — there is no membership to stand on.
  if (!job.created_by) {
    return { ok: false, reason: "job has no recorded creator" };
  }
  if (!(await store.isMember(job.workspace_id, job.created_by))) {
    return { ok: false, reason: "the user who enqueued this job is no longer a workspace member" };
  }
  return { ok: true };
}

export interface RunLimits {
  maxConcurrentPerWorkspace: number;
  dailyJobLimitPerWorkspace: number;
}

/**
 * Run limits. A job over a limit is DEFERRED (left queued), not failed —
 * the window slides and a later worker pass can pick it up.
 */
export async function checkRunLimits(
  store: JobStore,
  job: JobRow,
  limits: RunLimits,
): Promise<PolicyDecision> {
  const running = await store.countRunningByWorkspace(job.workspace_id);
  if (running >= limits.maxConcurrentPerWorkspace) {
    return {
      ok: false,
      reason: `workspace concurrency cap reached (${running}/${limits.maxConcurrentPerWorkspace} running)`,
    };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await store.countRecentByWorkspace(job.workspace_id, since);
  if (recent >= limits.dailyJobLimitPerWorkspace) {
    return {
      ok: false,
      reason: `workspace daily job quota reached (${recent}/${limits.dailyJobLimitPerWorkspace} in 24h)`,
    };
  }
  return { ok: true };
}
