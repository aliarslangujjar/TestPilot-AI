"use server";

import type { ActionResult } from "@/lib/action-result";
import { parseStoredFailureAnalysis, type StoredFailureAnalysis } from "@/lib/ai-analysis/envelope";
import { buildFailureEvidence, sanitizeEvidenceText } from "@/lib/ai-analysis/evidence";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { browserJobResultSchema } from "@schemas/browser-job";
import { browserTestPlanSchema } from "@schemas/browser-test";
import type { CaseSnapshot, ExecutionStatus, ResultOutcome, RunStatus } from "@schemas/test-run";

/**
 * Enriched automated-run detail: run status + duration, per-test
 * results with failed steps, expected vs. actual, sanitized logs,
 * artifact metadata, and any stored AI analysis.
 *
 * Everything user-visible is re-sanitized on the way out (the worker
 * sanitizes at write time; this is a second pass — defense in depth
 * for anything stored before a sanitizer fix). Artifact paths come
 * back as metadata only — clients exchange them for short-lived
 * signed URLs via lib/run-details/artifacts.ts.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Test run not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

export interface StepDetail {
  index: number;
  action: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
}

export interface ResultDetail {
  resultId: string;
  testCaseId: string | null;
  caseTitle: string;
  outcome: ResultOutcome;
  executionStatus: ExecutionStatus | null;
  browserJobId: string | null;
  attempts: number | null;
  failureKind: "assertion" | "infra" | "timeout" | null;
  durationMs: number | null;
  steps: StepDetail[];
  /** From the validated evidence bundle (failed/timed-out only). */
  expected: string | null;
  actual: string | null;
  logs: { consoleErrors: string[]; networkErrors: string[] };
  /** Artifact metadata: storage paths only (binaries stay private). */
  artifacts: string[];
  analysis: StoredFailureAnalysis | null;
}

export interface AutomatedRunDetail {
  runId: string;
  name: string;
  status: RunStatus;
  executionStatus: ExecutionStatus | null;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  summary: {
    total: number;
    passed: number;
    failed: number;
    timedOut: number;
    cancelled: number;
    queued: number;
    running: number;
  };
  results: ResultDetail[];
}

interface ResultRow {
  id: string;
  test_case_id: string | null;
  snapshot: CaseSnapshot;
  outcome: ResultOutcome;
  browser_job_id: string | null;
  execution_status: ExecutionStatus | null;
  artifacts: string[];
  failure_analysis: unknown;
}

interface JobRow {
  id: string;
  status: string;
  failure_kind: "assertion" | "infra" | "timeout" | null;
  attempts: number;
  error: string | null;
  plan: unknown;
  result: unknown;
}

function resultDurationMs(job: JobRow | undefined): number | null {
  if (!job) return null;
  const parsed = browserJobResultSchema.safeParse(job.result);
  if (!parsed.success) return null;
  const started = Date.parse(parsed.data.startedAt);
  const finished = Date.parse(parsed.data.finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) return null;
  return finished - started;
}

function toResultDetail(result: ResultRow, job: JobRow | undefined): ResultDetail {
  const parsedResult = job ? browserJobResultSchema.safeParse(job.result) : null;
  const steps: StepDetail[] =
    parsedResult?.success === true
      ? parsedResult.data.steps.map((s) => ({
          index: s.index,
          action: s.action,
          ok: s.ok,
          durationMs: s.durationMs,
          error: s.error ? sanitizeEvidenceText(s.error, 500) : null,
        }))
      : [];

  // Expected vs. actual come from the same validated evidence bundle
  // the AI analysis consumes — one source of truth.
  let expected: string | null = null;
  let actual: string | null = null;
  if (job && (result.execution_status === "failed" || result.execution_status === "timed_out")) {
    const plan = browserTestPlanSchema.safeParse(job.plan);
    if (plan.success) {
      const evidence = buildFailureEvidence(
        { execution_status: result.execution_status, snapshot: result.snapshot },
        {
          status: job.status,
          failure_kind: job.failure_kind,
          attempts: job.attempts,
          error: job.error,
          plan: plan.data,
          result: parsedResult?.success ? parsedResult.data : null,
        },
      );
      expected = evidence.expected;
      actual = evidence.actual;
    }
  }

  return {
    resultId: result.id,
    testCaseId: result.test_case_id,
    caseTitle: result.snapshot.title,
    outcome: result.outcome,
    executionStatus: result.execution_status,
    browserJobId: result.browser_job_id,
    attempts: job?.attempts ?? null,
    failureKind: job?.failure_kind ?? null,
    durationMs: resultDurationMs(job),
    steps,
    expected,
    actual,
    logs: {
      consoleErrors:
        parsedResult?.success === true
          ? (parsedResult.data.diagnostics?.consoleErrors ?? []).map((e) =>
              sanitizeEvidenceText(e, 300),
            )
          : [],
      networkErrors:
        parsedResult?.success === true
          ? (parsedResult.data.diagnostics?.networkErrors ?? []).map((e) =>
              sanitizeEvidenceText(e, 300),
            )
          : [],
    },
    artifacts: result.artifacts ?? [],
    analysis: parseStoredFailureAnalysis(result.failure_analysis),
  };
}

export async function getAutomatedRunDetail(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<AutomatedRunDetail>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);

    const { data: runData } = await supabase
      .from("test_runs")
      .select("id,name,source,status,execution_status,created_at,completed_at")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", runId)
      .maybeSingle();
    if (!runData) return { ok: false, error: NOT_FOUND };
    const run = runData as {
      id: string;
      name: string;
      source: string;
      status: RunStatus;
      execution_status: ExecutionStatus | null;
      created_at: string;
      completed_at: string | null;
    };
    if (run.source !== "automated") return { ok: false, error: NOT_FOUND };

    const { data: resultData, error: resultsError } = await supabase
      .from("run_results")
      .select(
        "id,test_case_id,snapshot,outcome,browser_job_id,execution_status,artifacts,failure_analysis,created_at",
      )
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (resultsError) return { ok: false, error: UNEXPECTED };
    const results = (resultData ?? []) as ResultRow[];

    const jobIds = results.map((r) => r.browser_job_id).filter((id): id is string => id !== null);
    const jobsById = new Map<string, JobRow>();
    if (jobIds.length > 0) {
      const { data: jobData, error: jobsError } = await supabase
        .from("browser_jobs")
        .select("id,status,failure_kind,attempts,error,plan,result")
        .eq("workspace_id", workspaceId)
        .in("id", jobIds);
      if (jobsError) return { ok: false, error: UNEXPECTED };
      for (const job of (jobData ?? []) as JobRow[]) jobsById.set(job.id, job);
    }

    const details = results.map((r) =>
      toResultDetail(r, r.browser_job_id ? jobsById.get(r.browser_job_id) : undefined),
    );

    const count = (s: ExecutionStatus) => details.filter((d) => d.executionStatus === s).length;
    const created = Date.parse(run.created_at);
    const completed = run.completed_at ? Date.parse(run.completed_at) : NaN;

    return {
      ok: true,
      data: {
        runId: run.id,
        name: run.name,
        status: run.status,
        executionStatus: run.execution_status,
        createdAt: run.created_at,
        completedAt: run.completed_at,
        durationMs: !Number.isNaN(completed) && completed >= created ? completed - created : null,
        summary: {
          total: details.length,
          passed: count("passed"),
          failed: count("failed"),
          timedOut: count("timed_out"),
          cancelled: count("cancelled"),
          queued: count("queued"),
          running: count("running"),
        },
        results: details,
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return { ok: false, error: NO_ACCESS };
    return { ok: false, error: UNEXPECTED };
  }
}
