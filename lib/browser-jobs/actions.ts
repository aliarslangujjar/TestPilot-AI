"use server";

import { randomUUID } from "node:crypto";

import type { ActionResult } from "@/lib/action-result";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import {
  enqueueBrowserJobSchema,
  type BrowserJob,
  type BrowserJobResult,
} from "@schemas/browser-job";
import type { BrowserTestPlan } from "@schemas/browser-test";

/**
 * Browser job queue — web app side.
 *
 * Members enqueue fully validated v1 plans and request cancellation.
 * The worker is the authority: it re-validates the payload, workspace
 * authorization, run limits, and target allowlists before executing.
 * These actions never execute anything and never claim a plan has run.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const UNEXPECTED = "Something went wrong. Please try again.";

interface BrowserJobRow {
  id: string;
  workspace_id: string;
  project_id: string;
  run_id: string | null;
  test_case_id: string | null;
  idempotency_key: string;
  plan: BrowserTestPlan;
  status: BrowserJob["status"];
  failure_kind: BrowserJob["failureKind"];
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  result: BrowserJobResult | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toBrowserJob(row: BrowserJobRow): BrowserJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    runId: row.run_id,
    testCaseId: row.test_case_id,
    idempotencyKey: row.idempotency_key,
    plan: row.plan,
    status: row.status,
    failureKind: row.failure_kind,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    cancelRequested: row.cancel_requested,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    result: row.result,
    error: row.error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface EnqueuedBrowserJob {
  job: BrowserJob;
  /** True when the idempotency key already existed (no new job created). */
  deduplicated: boolean;
}

export async function enqueueBrowserJob(input: unknown): Promise<ActionResult<EnqueuedBrowserJob>> {
  const parsed = enqueueBrowserJobSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const { workspaceId, projectId, runId, testCaseId, plan } = parsed.data;
  const idempotencyKey = parsed.data.idempotencyKey?.trim() || randomUUID();

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);

    // Project must belong to this workspace.
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return { ok: false, error: "Project not found." };

    const { data, error } = await supabase
      .from("browser_jobs")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        run_id: runId ?? null,
        test_case_id: testCaseId ?? null,
        idempotency_key: idempotencyKey,
        plan,
        created_by: userId,
      })
      .select("*")
      .single();

    if (error) {
      // Unique violation on (workspace_id, idempotency_key) → return the
      // existing job: re-submission is a no-op, not a duplicate run.
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("browser_jobs")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (existing) {
          return {
            ok: true,
            data: { job: toBrowserJob(existing as BrowserJobRow), deduplicated: true },
          };
        }
      }
      return { ok: false, error: UNEXPECTED };
    }

    return { ok: true, data: { job: toBrowserJob(data as BrowserJobRow), deduplicated: false } };
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return { ok: false, error: NO_ACCESS };
    return { ok: false, error: UNEXPECTED };
  }
}

/**
 * Request cancellation. Members have no direct UPDATE grant on
 * browser_jobs, so this goes through the service-role client AFTER a
 * membership check — the row's ownership is verified by the CAS on
 * workspace_id + status.
 */
export async function requestBrowserJobCancellation(
  workspaceId: string,
  jobId: string,
): Promise<ActionResult<{ jobId: string }>> {
  try {
    await requireWorkspaceClient(workspaceId);
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("browser_jobs")
      .update({ cancel_requested: true })
      .eq("id", jobId)
      .eq("workspace_id", workspaceId)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "Job not found." };
    return { ok: true, data: { jobId } };
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return { ok: false, error: NO_ACCESS };
    return { ok: false, error: UNEXPECTED };
  }
}

export async function listBrowserJobs(
  workspaceId: string,
  projectId?: string,
): Promise<ActionResult<BrowserJob[]>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    let query = supabase
      .from("browser_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) return { ok: false, error: UNEXPECTED };
    return { ok: true, data: ((data ?? []) as BrowserJobRow[]).map(toBrowserJob) };
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return { ok: false, error: NO_ACCESS };
    return { ok: false, error: UNEXPECTED };
  }
}
