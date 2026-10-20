"use server";

import type { ActionResult } from "@/lib/action-result";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { browserJobResultSchema } from "@schemas/browser-job";
import type { ExecutionStatus } from "@schemas/test-run";

/**
 * Automated run comparison: match results across two runs by test
 * case, then classify each case's trajectory — what got fixed, what
 * regressed, what is still failing, and what is new or gone.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Test run not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const BAD: ExecutionStatus[] = ["failed", "timed_out"];
const GOOD: ExecutionStatus[] = ["passed"];

export type CaseChange =
  "fixed" | "regressed" | "still_failing" | "unchanged" | "changed_other" | "added" | "removed";

export interface CaseComparison {
  testCaseId: string | null;
  caseTitle: string;
  baseExecutionStatus: ExecutionStatus | null;
  otherExecutionStatus: ExecutionStatus | null;
  baseDurationMs: number | null;
  otherDurationMs: number | null;
  /** Positive when the other run took longer on this case. */
  durationDeltaMs: number | null;
  change: CaseChange;
}

export interface RunComparison {
  baseRunId: string;
  otherRunId: string;
  baseName: string;
  otherName: string;
  summary: Record<CaseChange, number>;
  cases: CaseComparison[];
}

interface JobLite {
  id: string;
  result: unknown;
}

function durationMs(job: JobLite | undefined): number | null {
  if (!job) return null;
  const parsed = browserJobResultSchema.safeParse(job.result);
  if (!parsed.success) return null;
  const started = Date.parse(parsed.data.startedAt);
  const finished = Date.parse(parsed.data.finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) return null;
  return finished - started;
}

function classify(base: ExecutionStatus | null, other: ExecutionStatus | null): CaseChange {
  if (base === null) return "added";
  if (other === null) return "removed";
  if (BAD.includes(base) && BAD.includes(other)) return "still_failing";
  if (BAD.includes(base) && GOOD.includes(other)) return "fixed";
  if (GOOD.includes(base) && BAD.includes(other)) return "regressed";
  if (base === other && GOOD.includes(base)) return "unchanged";
  return "changed_other";
}

export async function compareAutomatedRuns(
  workspaceId: string,
  projectId: string,
  baseRunId: string,
  otherRunId: string,
): Promise<ActionResult<RunComparison>> {
  if (baseRunId === otherRunId) {
    return { ok: false, error: "Pick two different runs to compare." };
  }

  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);

    const { data: runs } = await supabase
      .from("test_runs")
      .select("id,name,source")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .in("id", [baseRunId, otherRunId]);
    const runRows = (runs ?? []) as Array<{ id: string; name: string; source: string }>;
    const base = runRows.find((r) => r.id === baseRunId);
    const other = runRows.find((r) => r.id === otherRunId);
    if (!base || !other || base.source !== "automated" || other.source !== "automated") {
      return { ok: false, error: NOT_FOUND };
    }

    const { data: resultRows, error: resultsError } = await supabase
      .from("run_results")
      .select("run_id,test_case_id,snapshot,execution_status,browser_job_id")
      .eq("workspace_id", workspaceId)
      .in("run_id", [baseRunId, otherRunId]);
    if (resultsError) return { ok: false, error: UNEXPECTED };
    const results = (resultRows ?? []) as Array<{
      run_id: string;
      test_case_id: string | null;
      snapshot: { title: string };
      execution_status: ExecutionStatus | null;
      browser_job_id: string | null;
    }>;

    const jobIds = results.map((r) => r.browser_job_id).filter((id): id is string => id !== null);
    const jobsById = new Map<string, JobLite>();
    if (jobIds.length > 0) {
      const { data: jobRows, error: jobsError } = await supabase
        .from("browser_jobs")
        .select("id,result")
        .eq("workspace_id", workspaceId)
        .in("id", jobIds);
      if (jobsError) return { ok: false, error: UNEXPECTED };
      for (const j of (jobRows ?? []) as JobLite[]) jobsById.set(j.id, j);
    }

    // Match by test case; fall back to the snapshot title when the case
    // was deleted (test_case_id is nullable by design).
    const key = (r: { test_case_id: string | null; snapshot: { title: string } }) =>
      r.test_case_id ?? `title:${r.snapshot.title}`;
    const byRun = new Map<string, Map<string, (typeof results)[number]>>();
    for (const r of results) {
      const map = byRun.get(r.run_id) ?? new Map();
      map.set(key(r), r);
      byRun.set(r.run_id, map);
    }
    const baseMap = byRun.get(baseRunId) ?? new Map();
    const otherMap = byRun.get(otherRunId) ?? new Map();
    const allKeys = new Set([...baseMap.keys(), ...otherMap.keys()]);

    const cases: CaseComparison[] = [];
    const summary: Record<CaseChange, number> = {
      fixed: 0,
      regressed: 0,
      still_failing: 0,
      unchanged: 0,
      changed_other: 0,
      added: 0,
      removed: 0,
    };

    for (const k of [...allKeys].sort()) {
      const b = baseMap.get(k);
      const o = otherMap.get(k);
      const change = classify(b?.execution_status ?? null, o?.execution_status ?? null);
      summary[change] += 1;
      const baseDur = durationMs(b?.browser_job_id ? jobsById.get(b.browser_job_id) : undefined);
      const otherDur = durationMs(o?.browser_job_id ? jobsById.get(o.browser_job_id) : undefined);
      cases.push({
        testCaseId: b?.test_case_id ?? o?.test_case_id ?? null,
        caseTitle: b?.snapshot.title ?? o?.snapshot.title ?? "Unknown case",
        baseExecutionStatus: b?.execution_status ?? null,
        otherExecutionStatus: o?.execution_status ?? null,
        baseDurationMs: baseDur,
        otherDurationMs: otherDur,
        durationDeltaMs: baseDur !== null && otherDur !== null ? otherDur - baseDur : null,
        change,
      });
    }

    return {
      ok: true,
      data: {
        baseRunId,
        otherRunId,
        baseName: base.name,
        otherName: other.name,
        summary,
        cases,
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return { ok: false, error: NO_ACCESS };
    return { ok: false, error: UNEXPECTED };
  }
}
