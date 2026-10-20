"use server";

import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";

/**
 * Private browser-artifact access.
 *
 * Binaries live in the private `browser-artifacts` storage bucket; the
 * database only ever holds paths (metadata). Downloads happen through
 * SHORT-LIVED signed URLs minted by the service role after authorization:
 *
 * 1. caller is a workspace member (requireWorkspaceClient)
 * 2. the path is well-formed: `<workspaceId>/<jobId>/step-<n>.png` —
 *    no `..`, no backslashes, no empty segments, and the first segment
 *    must be the caller's workspace id
 * 3. the path is actually referenced by a job in this workspace
 *    (run_results.artifacts @> path) — membership of one workspace
 *    must never reach another workspace's files
 *
 * Size limits are enforced at upload time by the worker (≤1MB per
 * screenshot, ≤2 per job). Retention: artifacts expire by age;
 * `pruneBrowserArtifacts` removes them in bounded batches.
 */

import {
  ARTIFACT_RETENTION_DAYS,
  ARTIFACT_URL_TTL_SECONDS,
  BROWSER_ARTIFACTS_BUCKET as BUCKET,
  MIN_ARTIFACT_RETENTION_DAYS as MIN_RETENTION_DAYS,
  PRUNE_BATCH_LIMIT,
} from "./constants";

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Artifact not found or expired.";
const UNEXPECTED = "Something went wrong. Please try again.";

function validateArtifactPath(workspaceId: string, path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 500) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("//")) return false;
  const segments = path.split("/");
  if (segments.length < 3) return false; // workspace/job/file.png
  if (segments.some((s) => s.length === 0 || s.includes("\0"))) return false;
  return segments[0] === workspaceId;
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

/**
 * Mint a short-lived signed URL for one artifact, after full
 * authorization. Returns a clean "not found or expired" error rather
 * than leaking whether the object exists.
 */
export async function getArtifactSignedUrl(
  workspaceId: string,
  projectId: string,
  runId: string,
  artifactPath: string,
): Promise<ActionResult<{ url: string; expiresIn: number }>> {
  if (!validateArtifactPath(workspaceId, artifactPath)) {
    return { ok: false, error: NOT_FOUND };
  }

  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);

    // The artifact must belong to a job linked to THIS run. A path that
    // merely matches the prefix is not enough — it must be referenced.
    const { data: linked, error: linkError } = await supabase
      .from("run_results")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .contains("artifacts", [artifactPath])
      .limit(1);
    if (linkError || !linked || (linked as unknown[]).length === 0) {
      return { ok: false, error: NOT_FOUND };
    }

    // Project scoping for the run itself (cheap, keeps contracts tight).
    const { data: run } = await supabase
      .from("test_runs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", runId)
      .maybeSingle();
    if (!run) return { ok: false, error: NOT_FOUND };

    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(artifactPath, ARTIFACT_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return { ok: false, error: NOT_FOUND };

    return {
      ok: true,
      data: { url: data.signedUrl, expiresIn: ARTIFACT_URL_TTL_SECONDS },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export interface PruneResult {
  deleted: number;
  scanned: number;
  retentionDays: number;
}

/**
 * Delete artifact binaries older than the retention window, in bounded
 * batches. Members only; the retention floor protects against
 * accidental low values. Skips anything the listing cannot age.
 */
export async function pruneBrowserArtifacts(
  workspaceId: string,
  retentionDays: number = ARTIFACT_RETENTION_DAYS,
): Promise<ActionResult<PruneResult>> {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < MIN_RETENTION_DAYS ||
    retentionDays > 365
  ) {
    return {
      ok: false,
      error: `Retention must be between ${MIN_RETENTION_DAYS} and 365 days.`,
    };
  }

  try {
    await requireWorkspaceClient(workspaceId);
    const admin = createAdminClient();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    // Layout is <workspaceId>/<jobId>/step-<n>.png — list per job dir.
    const { data: topLevel, error: topError } = await admin.storage
      .from(BUCKET)
      .list(workspaceId, { limit: PRUNE_BATCH_LIMIT });
    if (topError) return { ok: false, error: UNEXPECTED };

    const expired: string[] = [];
    let scanned = 0;
    for (const entry of topLevel ?? []) {
      // Descend only into job directories: in storage listings, folders
      // have a null id while files carry one. Files sitting directly at
      // the workspace root are not worker artifacts — leave them alone.
      if (entry.id !== null) continue;
      const { data: files } = await admin.storage
        .from(BUCKET)
        .list(`${workspaceId}/${entry.name}`, { limit: PRUNE_BATCH_LIMIT });
      for (const file of files ?? []) {
        scanned += 1;
        if (expired.length >= PRUNE_BATCH_LIMIT) break;
        const created = file.created_at ? Date.parse(file.created_at) : NaN;
        if (Number.isNaN(created)) continue; // cannot age → never delete
        if (created < cutoff) expired.push(`${workspaceId}/${entry.name}/${file.name}`);
      }
      if (expired.length >= PRUNE_BATCH_LIMIT) break;
    }

    if (expired.length > 0) {
      const { error } = await admin.storage.from(BUCKET).remove(expired);
      if (error) return { ok: false, error: UNEXPECTED };
    }

    return { ok: true, data: { deleted: expired.length, scanned, retentionDays } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
