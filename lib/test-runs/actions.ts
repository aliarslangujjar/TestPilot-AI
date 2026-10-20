"use server";

import { revalidatePath } from "next/cache";

import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import type { ActionResult } from "@/lib/action-result";
import {
  createRunSchema,
  runFilterSchema,
  updateResultSchema,
  type CaseSnapshot,
  type CreateRunInput,
  type ExecutionStatus,
  type ResultOutcome,
  type RunResult,
  type RunStatus,
  type RunSummary,
  type TestRun,
  type UpdateResultInput,
} from "@schemas/test-run";

/**
 * Manual test execution.
 *
 * A run freezes the selected test cases as JSON snapshots at creation time,
 * so later edits to the cases never rewrite execution history. Each result
 * records an outcome (unexecuted/pass/fail/blocked/skipped), notes, and who
 * ran it when.
 *
 * Summaries are computed from run_results at read time — there are no
 * denormalized counters, so concurrent result updates cannot corrupt them.
 *
 * Run lifecycle: in_progress -> completed -> in_progress (reopen).
 * Results can only change while the run is in progress.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Test run not found.";
const PROJECT_NOT_FOUND = "Project not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const RUN_COLUMNS =
  "id,workspace_id,project_id,suite_id,name,source,status,execution_status,notes,created_by,created_at,updated_at,completed_at";
const RESULT_COLUMNS =
  "id,run_id,workspace_id,test_case_id,snapshot,outcome,browser_job_id,execution_status,artifacts,notes,executed_by,executed_at,created_at,updated_at";

interface TestRunRow {
  id: string;
  workspace_id: string;
  project_id: string;
  suite_id: string | null;
  name: string;
  source: "manual" | "automated";
  status: RunStatus;
  execution_status: ExecutionStatus | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface TestCaseRow {
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

interface RunResultRow {
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

function toTestRun(row: TestRunRow): TestRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    suiteId: row.suite_id,
    name: row.name,
    source: row.source,
    status: row.status,
    executionStatus: row.execution_status,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function toRunResult(row: RunResultRow): RunResult {
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    testCaseId: row.test_case_id,
    snapshot: row.snapshot,
    outcome: row.outcome,
    browserJobId: row.browser_job_id,
    executionStatus: row.execution_status,
    artifacts: row.artifacts ?? [],
    notes: row.notes,
    executedBy: row.executed_by,
    executedAt: row.executed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function summarize(outcomes: string[]): RunSummary {
  const summary: RunSummary = {
    total: outcomes.length,
    unexecuted: 0,
    pass: 0,
    fail: 0,
    blocked: 0,
    skipped: 0,
  };
  for (const outcome of outcomes) {
    if (outcome in summary) summary[outcome as keyof Omit<RunSummary, "total">] += 1;
  }
  return summary;
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

type WorkspaceClient = Awaited<ReturnType<typeof requireWorkspaceClient>>;

async function getScopedProject(client: WorkspaceClient, workspaceId: string, projectId: string) {
  const { data, error } = await client.supabase
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function getScopedRun(
  client: WorkspaceClient,
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<TestRunRow | null> {
  const { data, error } = await client.supabase
    .from("test_runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) return null;
  return data as TestRunRow;
}

export interface TestRunWithSummary extends TestRun {
  summary: RunSummary;
}

export async function listRuns(
  workspaceId: string,
  projectId: string,
  filter?: { status?: RunStatus | null },
): Promise<ActionResult<TestRunWithSummary[]>> {
  try {
    const parsed = runFilterSchema.safeParse(filter ?? {});
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filter." };
    }
    const client = await requireWorkspaceClient(workspaceId);
    if (!(await getScopedProject(client, workspaceId, projectId))) {
      return { ok: false, error: PROJECT_NOT_FOUND };
    }

    let query = client.supabase
      .from("test_runs")
      .select(RUN_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (parsed.data.status) query = query.eq("status", parsed.data.status);
    const { data, error } = await query;
    if (error) return { ok: false, error: toError(error) };

    const rows = (data ?? []) as TestRunRow[];
    const runIds = rows.map((r) => r.id);
    const outcomesByRun = new Map<string, string[]>();
    if (runIds.length > 0) {
      const { data: results, error: resultsError } = await client.supabase
        .from("run_results")
        .select("run_id,outcome")
        .eq("workspace_id", workspaceId)
        .in("run_id", runIds);
      if (resultsError) return { ok: false, error: toError(resultsError) };
      for (const r of (results ?? []) as Array<{ run_id: string; outcome: string }>) {
        const list = outcomesByRun.get(r.run_id) ?? [];
        list.push(r.outcome);
        outcomesByRun.set(r.run_id, list);
      }
    }

    return {
      ok: true,
      data: rows.map((row) => ({
        ...toTestRun(row),
        summary: summarize(outcomesByRun.get(row.id) ?? []),
      })),
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function getRun(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<TestRunWithSummary>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const row = await getScopedRun(client, workspaceId, projectId, runId);
    if (!row) return { ok: false, error: NOT_FOUND };

    const { data, error } = await client.supabase
      .from("run_results")
      .select("outcome")
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId);
    if (error) return { ok: false, error: toError(error) };

    return {
      ok: true,
      data: {
        ...toTestRun(row),
        summary: summarize(((data ?? []) as Array<{ outcome: string }>).map((r) => r.outcome)),
      },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function listRunResults(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<RunResult[]>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const run = await getScopedRun(client, workspaceId, projectId, runId);
    if (!run) return { ok: false, error: NOT_FOUND };

    const { data, error } = await client.supabase
      .from("run_results")
      .select(RESULT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (error) return { ok: false, error: toError(error) };

    return { ok: true, data: ((data ?? []) as RunResultRow[]).map(toRunResult) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function createRun(
  workspaceId: string,
  projectId: string,
  input: CreateRunInput,
): Promise<ActionResult<TestRunWithSummary>> {
  try {
    const parsed = createRunSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const client = await requireWorkspaceClient(workspaceId);
    if (!(await getScopedProject(client, workspaceId, projectId))) {
      return { ok: false, error: PROJECT_NOT_FOUND };
    }

    if (parsed.data.suiteId) {
      const { data: suite, error: suiteError } = await client.supabase
        .from("suites")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("project_id", projectId)
        .eq("id", parsed.data.suiteId)
        .maybeSingle();
      if (suiteError || !suite) return { ok: false, error: "Suite not found." };
    }

    const testCaseIds = [...new Set(parsed.data.testCaseIds)];
    let casesQuery = client.supabase
      .from("test_cases")
      .select("id,title,description,preconditions,steps,expected_results,priority,tags,status")
      .eq("workspace_id", workspaceId)
      .eq("is_archived", false)
      .in("id", testCaseIds);
    if (parsed.data.suiteId) casesQuery = casesQuery.eq("suite_id", parsed.data.suiteId);
    const { data: cases, error: casesError } = await casesQuery;
    if (casesError) return { ok: false, error: toError(casesError) };
    const caseRows = (cases ?? []) as TestCaseRow[];
    if (caseRows.length !== testCaseIds.length) {
      return { ok: false, error: "Some test cases were not found." };
    }

    const { data: run, error: runError } = await client.supabase
      .from("test_runs")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        suite_id: parsed.data.suiteId ?? null,
        name: parsed.data.name,
        source: "manual",
        notes: parsed.data.notes?.trim() || null,
        created_by: client.userId,
      })
      .select(RUN_COLUMNS)
      .single();
    if (runError || !run) return { ok: false, error: toError(runError) };
    const runRow = run as TestRunRow;

    // Freeze each case as a snapshot: later edits never rewrite this history.
    const resultRows = caseRows.map((c) => ({
      run_id: runRow.id,
      workspace_id: workspaceId,
      test_case_id: c.id,
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
    const { error: resultsError } = await client.supabase.from("run_results").insert(resultRows);
    if (resultsError) {
      // Don't leave a result-less run behind.
      await client.supabase.from("test_runs").delete().eq("id", runRow.id);
      return { ok: false, error: toError(resultsError) };
    }

    revalidatePath(`/dashboard/projects/${projectId}/runs`);

    return {
      ok: true,
      data: {
        ...toTestRun(runRow),
        summary: summarize(resultRows.map(() => "unexecuted")),
      },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function setResultOutcome(
  workspaceId: string,
  projectId: string,
  runId: string,
  resultId: string,
  input: UpdateResultInput,
): Promise<ActionResult<RunResult>> {
  try {
    const parsed = updateResultSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const client = await requireWorkspaceClient(workspaceId);
    const run = await getScopedRun(client, workspaceId, projectId, runId);
    if (!run) return { ok: false, error: NOT_FOUND };
    if (run.status !== "in_progress") {
      return { ok: false, error: "This run is completed. Reopen it to change results." };
    }

    const { data: existing, error: fetchError } = await client.supabase
      .from("run_results")
      .select(RESULT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .eq("id", resultId)
      .maybeSingle();
    if (fetchError || !existing) return { ok: false, error: "Result not found." };

    const executed = parsed.data.outcome !== "unexecuted";
    const { data, error } = await client.supabase
      .from("run_results")
      .update({
        outcome: parsed.data.outcome,
        notes: parsed.data.notes?.trim() || null,
        executed_by: executed ? client.userId : null,
        executed_at: executed ? new Date().toISOString() : null,
      })
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .eq("id", resultId)
      .select(RESULT_COLUMNS)
      .single();
    if (error || !data) return { ok: false, error: toError(error) };

    revalidatePath(`/dashboard/projects/${projectId}/runs/${runId}`);

    return { ok: true, data: toRunResult(data as RunResultRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

const INVALID_TRANSITION = "This run cannot move to that state.";

export async function completeRun(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<TestRunWithSummary>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const run = await getScopedRun(client, workspaceId, projectId, runId);
    if (!run) return { ok: false, error: NOT_FOUND };
    if (run.status !== "in_progress") return { ok: false, error: INVALID_TRANSITION };

    const { data, error } = await client.supabase
      .from("test_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", runId)
      .select(RUN_COLUMNS)
      .single();
    if (error || !data) return { ok: false, error: toError(error) };

    revalidatePath(`/dashboard/projects/${projectId}/runs`);
    revalidatePath(`/dashboard/projects/${projectId}/runs/${runId}`);

    const summary = await getRun(workspaceId, projectId, runId);
    return {
      ok: true,
      data: {
        ...toTestRun(data as TestRunRow),
        summary: summary.ok ? summary.data.summary : summarize([]),
      },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function reopenRun(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<TestRunWithSummary>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const run = await getScopedRun(client, workspaceId, projectId, runId);
    if (!run) return { ok: false, error: NOT_FOUND };
    if (run.status !== "completed") return { ok: false, error: INVALID_TRANSITION };

    const { data, error } = await client.supabase
      .from("test_runs")
      .update({ status: "in_progress", completed_at: null })
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", runId)
      .select(RUN_COLUMNS)
      .single();
    if (error || !data) return { ok: false, error: toError(error) };

    revalidatePath(`/dashboard/projects/${projectId}/runs`);
    revalidatePath(`/dashboard/projects/${projectId}/runs/${runId}`);

    const summary = await getRun(workspaceId, projectId, runId);
    return {
      ok: true,
      data: {
        ...toTestRun(data as TestRunRow),
        summary: summary.ok ? summary.data.summary : summarize([]),
      },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
