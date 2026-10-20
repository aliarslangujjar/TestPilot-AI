"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { rollupExecutionStatus } from "@/lib/test-runs/rollup";
import { validateWorkerEvidence } from "@/lib/test-runs/evidence";
import { getUsageLimits } from "@/lib/usage/limits";
import { getUsageCounters, meterUsage, releaseUsage, reserveUsage } from "@/lib/usage/usage";
import { browserJobResultSchema } from "@schemas/browser-job";
import { browserTestPlanSchema, type BrowserTestPlan } from "@schemas/browser-test";
import {
  createRunSchema,
  type CaseSnapshot,
  type ExecutionStatus,
  type ResultOutcome,
} from "@schemas/test-run";

/**
 * Automated test runs — the bridge between the test-run API and the
 * browser-job queue / Playwright worker.
 *
 * Flow: each case in an automated run needs a saved v1 browser plan
 * (browser_plans). Creating the run snapshots the cases (same as manual
 * runs), enqueues one browser job per case (deterministic idempotency
 * keys), and links each run result to its job. The worker claims jobs
 * atomically, executes them, and writes sanitized results back to the
 * job row. `refreshAutomatedRun` syncs job state into run state —
 * idempotently — and is the ONLY path that can mark a result passed,
 * and only on validated worker evidence (see validateWorkerEvidence).
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Test run not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const uuidSchema = z.string().uuid();

const RESULT_COLUMNS =
  "id,run_id,workspace_id,test_case_id,snapshot,outcome,browser_job_id,execution_status,artifacts,notes,executed_by,executed_at,created_at,updated_at";
const JOB_COLUMNS = "id,status,failure_kind,cancel_requested,plan,result";
const CASE_COLUMNS =
  "id,title,description,preconditions,steps,expected_results,priority,tags,status";

interface ResultRow {
  id: string;
  run_id: string;
  workspace_id: string;
  test_case_id: string | null;
  snapshot: CaseSnapshot;
  outcome: ResultOutcome;
  browser_job_id: string | null;
  execution_status: ExecutionStatus | null;
  artifacts: string[];
  notes: string | null;
  executed_by: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface JobRow {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  failure_kind: "assertion" | "infra" | "timeout" | null;
  cancel_requested: boolean;
  plan: { steps?: unknown[] } | null;
  result: unknown;
}

interface CaseRow {
  id: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  steps: Array<{ action: string; expected: string | null }>;
  expected_results: string | null;
  priority: string;
  tags: string[];
  status: string;
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

const TERMINAL: ExecutionStatus[] = ["passed", "failed", "cancelled", "timed_out"];

/** Sanitized artifact references: storage paths only, capped. */
function sanitizeArtifacts(result: unknown): string[] {
  const parsed = browserJobResultSchema.safeParse(result);
  if (!parsed.success) return [];
  return parsed.data.artifacts
    .filter((a) => typeof a === "string" && a.length > 0)
    .map((a) => a.slice(0, 500))
    .slice(0, 5);
}

function resultFinishedAt(result: unknown): string | null {
  const parsed = browserJobResultSchema.safeParse(result);
  if (!parsed.success) return null;
  const finished = parsed.data.finishedAt;
  return Number.isNaN(Date.parse(finished)) ? null : finished;
}

/** Whole execution seconds from the worker's own started/finished stamps. */
function resultDurationSeconds(result: unknown): number {
  const parsed = browserJobResultSchema.safeParse(result);
  if (!parsed.success) return 0;
  const ms = Date.parse(parsed.data.finishedAt) - Date.parse(parsed.data.startedAt);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  // A single job is capped at one hour for metering sanity.
  return Math.min(3600, Math.round(ms / 1000));
}

interface DerivedState {
  status: ExecutionStatus;
  outcome: ResultOutcome | null; // null = leave outcome untouched
  artifacts: string[];
  executedAt: string | null;
}

function deriveState(job: JobRow): DerivedState {
  const artifacts = sanitizeArtifacts(job.result);
  const finishedAt = resultFinishedAt(job.result);
  switch (job.status) {
    case "queued":
      // Cancellation is already requested for a still-queued job: the
      // worker can never execute its steps (it checks cancel before the
      // first step), so the result is settled as cancelled.
      return job.cancel_requested
        ? { status: "cancelled", outcome: null, artifacts, executedAt: null }
        : { status: "queued", outcome: null, artifacts: [], executedAt: null };
    case "running":
      return { status: "running", outcome: null, artifacts: [], executedAt: null };
    case "cancelled":
      return { status: "cancelled", outcome: null, artifacts, executedAt: finishedAt };
    case "succeeded": {
      const planSteps = Array.isArray(job.plan?.steps) ? job.plan.steps.length : 0;
      const passed = validateWorkerEvidence({
        jobStatus: job.status,
        result: job.result,
        planSteps,
      });
      // Invalid evidence is never a pass — it is a failure.
      return passed
        ? { status: "passed", outcome: "pass", artifacts, executedAt: finishedAt }
        : { status: "failed", outcome: "fail", artifacts, executedAt: finishedAt };
    }
    case "failed":
      return job.failure_kind === "timeout"
        ? { status: "timed_out", outcome: "fail", artifacts, executedAt: finishedAt }
        : { status: "failed", outcome: "fail", artifacts, executedAt: finishedAt };
  }
}

// ---------------------------------------------------------------------------
// Browser plans
// ---------------------------------------------------------------------------

/** Store (or replace) the v1 browser plan that automates a test case. */
export async function saveBrowserPlan(
  workspaceId: string,
  projectId: string,
  testCaseId: string,
  plan: unknown,
): Promise<ActionResult<{ testCaseId: string }>> {
  const ids = z
    .object({ workspaceId: uuidSchema, projectId: uuidSchema, testCaseId: uuidSchema })
    .safeParse({ workspaceId, projectId, testCaseId });
  if (!ids.success) return { ok: false, error: "Invalid workspace, project, or test case." };
  const parsedPlan = browserTestPlanSchema.safeParse(plan);
  if (!parsedPlan.success) {
    return { ok: false, error: parsedPlan.error.issues[0]?.message ?? "Invalid browser plan." };
  }

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);
    const { data: testCase } = await supabase
      .from("test_cases")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", testCaseId)
      .maybeSingle();
    if (!testCase) return { ok: false, error: "Test case not found." };

    const { error } = await supabase.from("browser_plans").upsert(
      {
        workspace_id: workspaceId,
        project_id: projectId,
        test_case_id: testCaseId,
        plan: parsedPlan.data,
        created_by: userId,
      },
      { onConflict: "test_case_id" },
    );
    if (error) return { ok: false, error: UNEXPECTED };
    return { ok: true, data: { testCaseId } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function getBrowserPlan(
  workspaceId: string,
  testCaseId: string,
): Promise<ActionResult<{ plan: BrowserTestPlan | null }>> {
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(testCaseId).success) {
    return { ok: false, error: "Invalid workspace or test case." };
  }
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("browser_plans")
      .select("plan")
      .eq("workspace_id", workspaceId)
      .eq("test_case_id", testCaseId)
      .maybeSingle();
    if (error) return { ok: false, error: UNEXPECTED };
    if (!data) return { ok: true, data: { plan: null } };
    const parsed = browserTestPlanSchema.safeParse((data as { plan: unknown }).plan);
    return { ok: true, data: { plan: parsed.success ? parsed.data : null } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------------------------------------------------------------------------
// Automated runs
// ---------------------------------------------------------------------------

export interface AutomatedRunData {
  runId: string;
  executionStatus: ExecutionStatus;
  jobCount: number;
}

/**
 * Create an automated run: snapshot the cases, enqueue one job per case,
 * link results to jobs. Every case must have a saved browser plan — a
 * case without one cannot be automated, and the run is refused rather
 * than silently dropping it.
 */
export async function createAutomatedRun(
  workspaceId: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<AutomatedRunData>> {
  const parsed = createRunSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(projectId).success) {
    return { ok: false, error: "Invalid workspace or project." };
  }

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);

    if (parsed.data.suiteId) {
      const { data: suite } = await supabase
        .from("suites")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("project_id", projectId)
        .eq("id", parsed.data.suiteId)
        .maybeSingle();
      if (!suite) return { ok: false, error: "Suite not found." };
    }

    const { data: caseData, error: caseError } = await supabase
      .from("test_cases")
      .select(CASE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .in("id", parsed.data.testCaseIds);
    if (caseError) return { ok: false, error: UNEXPECTED };
    const cases = (caseData ?? []) as CaseRow[];
    if (cases.length !== parsed.data.testCaseIds.length) {
      return { ok: false, error: "Some test cases were not found." };
    }

    const { data: planData } = await supabase
      .from("browser_plans")
      .select("test_case_id,plan")
      .eq("workspace_id", workspaceId)
      .in("test_case_id", parsed.data.testCaseIds);
    const plans = new Map<string, BrowserTestPlan>();
    for (const row of (planData ?? []) as Array<{ test_case_id: string; plan: unknown }>) {
      const plan = browserTestPlanSchema.safeParse(row.plan);
      if (plan.success) plans.set(row.test_case_id, plan.data);
    }
    const withoutPlan = cases.filter((c) => !plans.has(c.id));
    if (withoutPlan.length > 0) {
      const titles = withoutPlan.map((c) => `"${c.title}"`).join(", ");
      return {
        ok: false,
        error: `These test cases have no browser plan and cannot be automated: ${titles}.`,
      };
    }

    // Preserve the caller's case order.
    const ordered = parsed.data.testCaseIds
      .map((id) => cases.find((c) => c.id === id))
      .filter((c): c is CaseRow => Boolean(c));

    // Free-plan budget pre-checks (docs/COST_MODEL.md): a workspace that
    // has already used up its execution-time or storage budget cannot
    // start new browser work until the next period.
    const usageLimits = getUsageLimits();
    const counters = await getUsageCounters(workspaceId).catch(() => null);
    if (counters && counters.executionSeconds >= usageLimits.executionSeconds) {
      return {
        ok: false,
        error: `Your workspace has used its free-plan execution time for this period (${usageLimits.executionSeconds} seconds). It resets next period.`,
      };
    }
    if (counters && counters.storageBytes >= usageLimits.storageBytes) {
      return {
        ok: false,
        error:
          "Your workspace has reached its free-plan artifact storage limit for this period. Delete old artifacts or wait for the next period.",
      };
    }

    const { data: run, error: runError } = await supabase
      .from("test_runs")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        suite_id: parsed.data.suiteId ?? null,
        name: parsed.data.name,
        source: "automated",
        execution_status: "queued",
        notes: parsed.data.notes?.trim() || null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (runError || !run) return { ok: false, error: UNEXPECTED };
    const runId = (run as { id: string }).id;

    // Reserve the browser runs against the period quota — atomically,
    // so concurrent run creations cannot both slip past the limit.
    const reserved = await reserveUsage(workspaceId, { browserRuns: ordered.length });
    if (!reserved) {
      await supabase.from("test_runs").delete().eq("id", runId);
      return {
        ok: false,
        error: `Your workspace has reached the free plan's limit of ${usageLimits.browserRuns} browser runs for this period. It resets next period.`,
      };
    }

    const fail = async (message: string): Promise<ActionResult<AutomatedRunData>> => {
      // Don't leave a job-less or result-less run behind, and give the
      // reserved browser runs back — failed creations are not billed.
      await releaseUsage(workspaceId, { browserRuns: ordered.length });
      await supabase.from("test_runs").delete().eq("id", runId);
      return { ok: false, error: message };
    };

    const resultRows = ordered.map((c) => ({
      run_id: runId,
      workspace_id: workspaceId,
      test_case_id: c.id,
      execution_status: "queued" as ExecutionStatus,
      snapshot: {
        title: c.title,
        description: c.description,
        preconditions: c.preconditions,
        steps: c.steps,
        expectedResults: c.expected_results,
        priority: c.priority,
        tags: c.tags,
        caseStatus: c.status,
      } satisfies CaseSnapshot,
    }));
    const { error: resultsError } = await supabase.from("run_results").insert(resultRows);
    if (resultsError) return fail(UNEXPECTED);

    const jobRows = ordered.map((c) => ({
      workspace_id: workspaceId,
      project_id: projectId,
      run_id: runId,
      test_case_id: c.id,
      // Deterministic per (run, case): re-submission cannot double-enqueue.
      idempotency_key: `run:${runId}:case:${c.id}`,
      plan: plans.get(c.id),
      created_by: userId,
    }));
    const { data: jobs, error: jobsError } = await supabase
      .from("browser_jobs")
      .insert(jobRows)
      .select("id,test_case_id");
    if (jobsError || !jobs) return fail(UNEXPECTED);

    for (const job of jobs as Array<{ id: string; test_case_id: string }>) {
      const { error } = await supabase
        .from("run_results")
        .update({ browser_job_id: job.id })
        .eq("run_id", runId)
        .eq("test_case_id", job.test_case_id);
      if (error) return fail(UNEXPECTED);
    }

    revalidatePath(`/dashboard/projects/${projectId}/runs`);
    return { ok: true, data: { runId, executionStatus: "queued", jobCount: jobs.length } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

async function loadAutomatedRun(
  supabase: Awaited<ReturnType<typeof requireWorkspaceClient>>["supabase"],
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<{ status: string; execution_status: ExecutionStatus | null } | null> {
  const { data } = await supabase
    .from("test_runs")
    .select("id,source,status,execution_status")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("id", runId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { status: string; execution_status: ExecutionStatus | null; source: string };
  if (row.source !== "automated") return null;
  return { status: row.status, execution_status: row.execution_status };
}

export interface RefreshData {
  changed: number;
  executionStatus: ExecutionStatus;
}

/**
 * Sync worker state into run state. Idempotent: re-running it (or
 * receiving the same job result twice) changes nothing the second time.
 * A result is marked passed ONLY through validateWorkerEvidence.
 */
export async function refreshAutomatedRun(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<RefreshData>> {
  if (
    !uuidSchema.safeParse(workspaceId).success ||
    !uuidSchema.safeParse(projectId).success ||
    !uuidSchema.safeParse(runId).success
  ) {
    return { ok: false, error: "Invalid workspace, project, or run." };
  }

  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const run = await loadAutomatedRun(supabase, workspaceId, projectId, runId);
    if (!run) return { ok: false, error: NOT_FOUND };

    const { data: resultData, error: resultsError } = await supabase
      .from("run_results")
      .select(RESULT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId);
    if (resultsError) return { ok: false, error: UNEXPECTED };
    const results = (resultData ?? []) as ResultRow[];
    const linked = results.filter((r) => r.browser_job_id !== null);

    const jobIds = linked.map((r) => r.browser_job_id as string);
    const jobsById = new Map<string, JobRow>();
    if (jobIds.length > 0) {
      const { data: jobData, error: jobsError } = await supabase
        .from("browser_jobs")
        .select(JOB_COLUMNS)
        .eq("workspace_id", workspaceId)
        .in("id", jobIds);
      if (jobsError) return { ok: false, error: UNEXPECTED };
      for (const job of (jobData ?? []) as JobRow[]) jobsById.set(job.id, job);
    }

    let changed = 0;
    let durationSeconds = 0;
    const finalStatuses: ExecutionStatus[] = [];
    for (const result of results) {
      const job = result.browser_job_id ? jobsById.get(result.browser_job_id) : undefined;
      if (!job) {
        // No worker state to sync from; keep the recorded status.
        if (result.execution_status) finalStatuses.push(result.execution_status);
        continue;
      }
      const next = deriveState(job);
      finalStatuses.push(next.status);

      const sameArtifacts =
        JSON.stringify([...result.artifacts].sort()) === JSON.stringify([...next.artifacts].sort());
      if (result.execution_status === next.status && sameArtifacts) continue;

      const patch: Record<string, unknown> = {
        execution_status: next.status,
        artifacts: next.artifacts,
      };
      if (next.outcome !== null && result.outcome === "unexecuted") {
        patch.outcome = next.outcome;
      }
      if (TERMINAL.includes(next.status) && result.executed_at === null) {
        patch.executed_at = next.executedAt ?? new Date().toISOString();
      }
      const { error } = await supabase
        .from("run_results")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", result.id);
      if (error) return { ok: false, error: UNEXPECTED };
      changed += 1;
      // First terminal transition for this result: meter the job's
      // execution duration exactly once (executed_at was null before).
      if (patch.executed_at) durationSeconds += resultDurationSeconds(job.result);
    }

    if (durationSeconds > 0) {
      await meterUsage(workspaceId, { executionSeconds: durationSeconds });
    }

    const rolled = rollupExecutionStatus(finalStatuses);
    const allTerminal =
      finalStatuses.length > 0 && finalStatuses.every((s) => TERMINAL.includes(s));
    // completed_at is set exactly once, on the terminal transition.
    const transitioning = allTerminal && run.status !== "completed";
    if (rolled !== run.execution_status || transitioning) {
      const runPatch: Record<string, unknown> = { execution_status: rolled };
      if (transitioning) {
        runPatch.status = "completed";
        runPatch.completed_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("test_runs")
        .update(runPatch)
        .eq("workspace_id", workspaceId)
        .eq("id", runId);
      if (error) return { ok: false, error: UNEXPECTED };
      revalidatePath(`/dashboard/projects/${projectId}/runs`);
    }

    return { ok: true, data: { changed, executionStatus: rolled } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

/**
 * Request cancellation of every non-terminal job in the run, then sync.
 * Members cannot UPDATE browser_jobs (no member policy), so the flag is
 * set through the service-role client after the membership check — the
 * same pattern as requestBrowserJobCancellation.
 */
export async function cancelAutomatedRun(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<RefreshData>> {
  if (
    !uuidSchema.safeParse(workspaceId).success ||
    !uuidSchema.safeParse(projectId).success ||
    !uuidSchema.safeParse(runId).success
  ) {
    return { ok: false, error: "Invalid workspace, project, or run." };
  }

  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const run = await loadAutomatedRun(supabase, workspaceId, projectId, runId);
    if (!run) return { ok: false, error: NOT_FOUND };

    const { data: jobs } = await supabase
      .from("browser_jobs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .in("status", ["queued", "running"]);
    if (jobs && jobs.length > 0) {
      const admin = createAdminClient();
      const { error } = await admin
        .from("browser_jobs")
        .update({ cancel_requested: true })
        .eq("workspace_id", workspaceId)
        .eq("run_id", runId)
        .in("status", ["queued", "running"]);
      if (error) return { ok: false, error: UNEXPECTED };
    }

    return refreshAutomatedRun(workspaceId, projectId, runId);
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
