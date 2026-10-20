"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { getAutomatedRunDetail } from "@/lib/run-details/details";
import { publicReportMetaSchema, type PublicReportMeta } from "@schemas/public-report";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { getRun, listRunResults } from "@/lib/test-runs/actions";

import { buildRunSnapshot, type SnapshotCaseInput, type SnapshotInput } from "./snapshot";
import { generateShareToken, hashShareToken } from "./token";

/**
 * Owner-side management of public reports. Creating a report snapshots
 * the run's public-safe summary; the raw share token is returned exactly
 * once (only its SHA-256 hash is stored). Revoking takes effect on the
 * next public read — reads always check revoked_at/expires_at.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Test run not found.";
const REPORT_NOT_FOUND = "Public report not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const createInputSchema = z.object({
  includeFailureDetails: z.boolean().default(false),
  noIndex: z.boolean().default(true),
  expiresInDays: z
    .union([z.literal(7), z.literal(30)])
    .nullable()
    .default(null),
});

const META_COLUMNS =
  "id,project_id,run_id,run_name,include_failure_details,no_index,expires_at,revoked_at,view_count,last_viewed_at,created_at";

interface MetaRow {
  id: string;
  project_id: string;
  run_id: string;
  run_name: string;
  include_failure_details: boolean;
  no_index: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

function toMeta(row: MetaRow): PublicReportMeta {
  return publicReportMetaSchema.parse({
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    runName: row.run_name,
    includeFailureDetails: row.include_failure_details,
    noIndex: row.no_index,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    createdAt: row.created_at,
  });
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

async function snapshotForRun(
  workspaceId: string,
  projectId: string,
  runId: string,
  projectName: string,
  includeFailureDetails: boolean,
): Promise<{ input: SnapshotInput; runName: string } | null> {
  // Automated runs first: the detail builder refuses manual runs with the
  // same NOT_FOUND, which is our signal to try the manual path.
  const automated = await getAutomatedRunDetail(workspaceId, projectId, runId);
  if (automated.ok) {
    const d = automated.data;
    const cases: SnapshotCaseInput[] = d.results.map((r) => ({
      title: r.caseTitle,
      status: r.executionStatus ?? "queued",
      durationMs: r.durationMs,
      expected: r.expected,
      actual: r.actual,
      failedStepAction: r.steps.find((s) => !s.ok)?.action ?? null,
      analysis: r.analysis
        ? {
            probableClassification: r.analysis.analysis.probableClassification,
            confidence: r.analysis.analysis.confidence,
            uncertainty: r.analysis.analysis.uncertainty,
          }
        : null,
    }));
    return {
      runName: d.name,
      input: {
        projectName,
        runName: d.name,
        source: "automated",
        status: d.status,
        executionStatus: d.executionStatus,
        createdAt: d.createdAt,
        completedAt: d.completedAt,
        durationMs: d.durationMs,
        includeFailureDetails,
        summary: {
          total: d.summary.total,
          passed: d.summary.passed,
          failed: d.summary.failed,
          timedOut: d.summary.timedOut,
          cancelled: d.summary.cancelled,
          blocked: 0,
          skipped: 0,
          unexecuted: d.summary.queued + d.summary.running,
        },
        cases,
        generatedAt: new Date(),
      },
    };
  }

  const run = await getRun(workspaceId, projectId, runId);
  if (!run.ok) return null;
  const results = await listRunResults(workspaceId, projectId, runId);
  if (!results.ok) return null;

  const r = run.data;
  const created = Date.parse(r.createdAt);
  const completed = r.completedAt ? Date.parse(r.completedAt) : NaN;
  const cases: SnapshotCaseInput[] = results.data.map((res) => ({
    title: res.snapshot.title,
    status: res.outcome,
    durationMs: null,
  }));
  return {
    runName: r.name,
    input: {
      projectName,
      runName: r.name,
      source: "manual",
      status: r.status,
      executionStatus: null,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      durationMs: !Number.isNaN(completed) && completed >= created ? completed - created : null,
      includeFailureDetails,
      summary: {
        total: r.summary.total,
        passed: r.summary.pass,
        failed: r.summary.fail,
        timedOut: 0,
        cancelled: 0,
        blocked: r.summary.blocked,
        skipped: r.summary.skipped,
        unexecuted: r.summary.unexecuted,
      },
      cases,
      generatedAt: new Date(),
    },
  };
}

export async function createPublicReport(
  workspaceId: string,
  projectId: string,
  runId: string,
  input: unknown,
): Promise<ActionResult<{ id: string; token: string; path: string }>> {
  const parsed = createInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const opts = parsed.data;

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);

    const { data: project } = await supabase
      .from("projects")
      .select("id,name")
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return { ok: false, error: NOT_FOUND };

    const built = await snapshotForRun(
      workspaceId,
      projectId,
      runId,
      (project as { name: string }).name,
      opts.includeFailureDetails,
    );
    if (!built) return { ok: false, error: NOT_FOUND };

    const snapshot = buildRunSnapshot(built.input);
    const token = generateShareToken();
    const expiresAt =
      opts.expiresInDays !== null
        ? new Date(Date.now() + opts.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

    const { data: row, error } = await supabase
      .from("public_reports")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        run_id: runId,
        run_name: built.runName.slice(0, 200),
        token_hash: hashShareToken(token),
        snapshot,
        include_failure_details: opts.includeFailureDetails,
        no_index: opts.noIndex,
        expires_at: expiresAt,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !row) return { ok: false, error: UNEXPECTED };

    revalidatePath(`/dashboard/projects/${projectId}/runs/${runId}`);
    // The raw token is returned exactly once — only its hash is stored.
    return { ok: true, data: { id: (row as { id: string }).id, token, path: `/r/${token}` } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function listPublicReports(
  workspaceId: string,
  projectId: string,
  runId: string,
): Promise<ActionResult<PublicReportMeta[]>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("public_reports")
      .select(META_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("run_id", runId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: UNEXPECTED };
    return { ok: true, data: ((data ?? []) as MetaRow[]).map(toMeta) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function revokePublicReport(
  workspaceId: string,
  projectId: string,
  reportId: string,
): Promise<ActionResult<{ revoked: true }>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data: existing } = await supabase
      .from("public_reports")
      .select("id,revoked_at")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", reportId)
      .maybeSingle();
    if (!existing) return { ok: false, error: REPORT_NOT_FOUND };
    if ((existing as { revoked_at: string | null }).revoked_at === null) {
      const { error } = await supabase
        .from("public_reports")
        .update({ revoked_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("id", reportId);
      if (error) return { ok: false, error: UNEXPECTED };
    }
    revalidatePath(`/dashboard/projects/${projectId}`);
    return { ok: true, data: { revoked: true } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
