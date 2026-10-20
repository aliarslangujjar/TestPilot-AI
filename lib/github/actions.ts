"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { checkRateLimit } from "@/lib/public-reports/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import {
  githubIntegrationSchema,
  githubRefSchema,
  githubWorkflowDispatchSchema,
  saveGitHubIntegrationSchema,
  workflowDispatchInputsSchema,
  type GitHubIntegration,
  type GitHubWorkflowDispatch,
} from "@schemas/github";

import {
  dispatchGitHubWorkflow as apiDispatch,
  getGitHubRepo,
  getGitHubWorkflow,
  GitHubApiError,
} from "./client";
import { DISPATCH_RATE_LIMIT, DISPATCH_RATE_WINDOW_MS } from "./constants";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * GitHub Actions integration actions.
 *
 * Secrets handling: the GitHub token and webhook secret are stored
 * AES-256-GCM encrypted in a table no client role can access
 * (github_integration_secrets, service-role only). Actions decrypt
 * server-side at the moment of use. Tokens are NEVER returned to the
 * browser after saving; the webhook secret is shown exactly once, at
 * creation, so the user can configure the GitHub webhook.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const PROJECT_NOT_FOUND = "Project not found.";
const INTEGRATION_NOT_FOUND = "GitHub integration not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const INTEGRATION_COLUMNS =
  "id,project_id,repo_owner,repo_name,workflow_file,default_ref,enabled,created_at,updated_at";

interface IntegrationRow {
  id: string;
  project_id: string;
  repo_owner: string;
  repo_name: string;
  workflow_file: string;
  default_ref: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface DispatchRow {
  id: string;
  status: GitHubWorkflowDispatch["status"];
  conclusion: string | null;
  github_run_id: number | null;
  github_run_url: string | null;
  ref: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toIntegration(row: IntegrationRow, hasToken: boolean): GitHubIntegration {
  return githubIntegrationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    workflowFile: row.workflow_file,
    defaultRef: row.default_ref,
    enabled: row.enabled,
    hasToken,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toDispatch(row: DispatchRow): GitHubWorkflowDispatch {
  return githubWorkflowDispatchSchema.parse({
    id: row.id,
    status: row.status,
    conclusion: row.conclusion,
    githubRunId: row.github_run_id,
    // Defense in depth for rows stored before the webhook validated
    // the scheme: non-https run URLs never reach the rendered href.
    githubRunUrl: row.github_run_url?.startsWith("https://") ? row.github_run_url : null,
    ref: row.ref,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  if (error instanceof GitHubApiError) return error.message;
  return UNEXPECTED;
}

type MemberClient = Awaited<ReturnType<typeof requireWorkspaceClient>>["supabase"];

async function loadIntegration(
  supabase: MemberClient,
  workspaceId: string,
  projectId: string,
): Promise<IntegrationRow | null> {
  const { data } = await supabase
    .from("github_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .maybeSingle();
  return (data as IntegrationRow | null) ?? null;
}

interface StoredSecrets {
  token: string;
  webhookSecret: string;
}

async function loadSecrets(integrationId: string): Promise<StoredSecrets | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("github_integration_secrets")
    .select("token_encrypted,webhook_secret_encrypted")
    .eq("integration_id", integrationId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { token_encrypted: string; webhook_secret_encrypted: string };
  return {
    token: decryptSecret(row.token_encrypted),
    webhookSecret: decryptSecret(row.webhook_secret_encrypted),
  };
}

async function storeSecrets(
  integrationId: string,
  secrets: { token?: string; webhookSecret?: string },
): Promise<void> {
  const admin = createAdminClient();
  const patch: Record<string, string> = { integration_id: integrationId };
  if (secrets.token !== undefined) patch.token_encrypted = encryptSecret(secrets.token);
  if (secrets.webhookSecret !== undefined) {
    patch.webhook_secret_encrypted = encryptSecret(secrets.webhookSecret);
  }
  await admin.from("github_integration_secrets").upsert(patch, { onConflict: "integration_id" });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getGitHubIntegration(
  workspaceId: string,
  projectId: string,
): Promise<ActionResult<GitHubIntegration | null>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const row = await loadIntegration(supabase, workspaceId, projectId);
    if (!row) return { ok: true, data: null };
    const secrets = await loadSecrets(row.id);
    return { ok: true, data: toIntegration(row, secrets !== null) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function listGitHubWorkflowDispatches(
  workspaceId: string,
  projectId: string,
): Promise<ActionResult<GitHubWorkflowDispatch[]>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("github_workflow_dispatches")
      .select("id,status,conclusion,github_run_id,github_run_url,ref,error,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { ok: false, error: UNEXPECTED };
    return { ok: true, data: ((data ?? []) as DispatchRow[]).map(toDispatch) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------------------------------------------------------------------------
// Save (validates the mapping against the live GitHub API)
// ---------------------------------------------------------------------------

export async function saveGitHubIntegration(
  workspaceId: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ integration: GitHubIntegration; webhookSecret: string | null }>> {
  const parsed = saveGitHubIntegrationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const data = parsed.data;

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return { ok: false, error: PROJECT_NOT_FOUND };

    const existing = await loadIntegration(supabase, workspaceId, projectId);
    const existingSecrets = existing ? await loadSecrets(existing.id) : null;

    // Effective token: newly supplied, or the stored one (mapping edits
    // are re-validated against it). A first save requires a token.
    const token = data.token ?? existingSecrets?.token;
    if (!token) {
      return { ok: false, error: "A GitHub token is required to connect this repository." };
    }

    // Validate the mapping with the scoped token: the repo must be the
    // repo the token can actually see, and the workflow must exist.
    let repoFullName: string;
    try {
      repoFullName = (await getGitHubRepo(token, data.repoOwner, data.repoName)).fullName;
    } catch {
      return {
        ok: false,
        error: `The token cannot access ${data.repoOwner}/${data.repoName}. Check the repository name and that the token is scoped to it.`,
      };
    }
    if (repoFullName.toLowerCase() !== `${data.repoOwner}/${data.repoName}`.toLowerCase()) {
      return { ok: false, error: "The token resolves to a different repository than requested." };
    }
    let workflowState: string;
    try {
      workflowState = (
        await getGitHubWorkflow(token, data.repoOwner, data.repoName, data.workflowFile)
      ).state;
    } catch {
      return {
        ok: false,
        error: `Workflow ${data.workflowFile} was not found in ${data.repoOwner}/${data.repoName}.`,
      };
    }
    if (workflowState !== "active") {
      return { ok: false, error: `Workflow ${data.workflowFile} is not active in GitHub.` };
    }

    let row: IntegrationRow;
    if (existing) {
      const { data: updated, error } = await supabase
        .from("github_integrations")
        .update({
          repo_owner: data.repoOwner,
          repo_name: data.repoName,
          workflow_file: data.workflowFile,
          default_ref: data.defaultRef,
        })
        .eq("id", existing.id)
        .select(INTEGRATION_COLUMNS)
        .single();
      if (error || !updated) return { ok: false, error: UNEXPECTED };
      row = updated as IntegrationRow;
      if (data.token) await storeSecrets(row.id, { token: data.token });
      return { ok: true, data: { integration: toIntegration(row, true), webhookSecret: null } };
    }

    const { data: inserted, error } = await supabase
      .from("github_integrations")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        repo_owner: data.repoOwner,
        repo_name: data.repoName,
        workflow_file: data.workflowFile,
        default_ref: data.defaultRef,
        created_by: userId,
      })
      .select(INTEGRATION_COLUMNS)
      .single();
    if (error || !inserted) return { ok: false, error: UNEXPECTED };
    row = inserted as IntegrationRow;

    // The webhook secret is generated here and shown exactly once.
    const webhookSecret = randomBytes(32).toString("base64url");
    await storeSecrets(row.id, { token, webhookSecret });

    revalidatePath(`/dashboard/projects/${projectId}/integrations`);
    return { ok: true, data: { integration: toIntegration(row, true), webhookSecret } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function setGitHubIntegrationEnabled(
  workspaceId: string,
  projectId: string,
  enabled: boolean,
): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const existing = await loadIntegration(supabase, workspaceId, projectId);
    if (!existing) return { ok: false, error: INTEGRATION_NOT_FOUND };
    const { error } = await supabase
      .from("github_integrations")
      .update({ enabled })
      .eq("id", existing.id);
    if (error) return { ok: false, error: UNEXPECTED };
    revalidatePath(`/dashboard/projects/${projectId}/integrations`);
    return { ok: true, data: { enabled } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function deleteGitHubIntegration(
  workspaceId: string,
  projectId: string,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const existing = await loadIntegration(supabase, workspaceId, projectId);
    if (!existing) return { ok: false, error: INTEGRATION_NOT_FOUND };
    // Secrets and dispatches cascade-delete with the integration row.
    const { error } = await supabase.from("github_integrations").delete().eq("id", existing.id);
    if (error) return { ok: false, error: UNEXPECTED };
    revalidatePath(`/dashboard/projects/${projectId}/integrations`);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------------------------------------------------------------------------
// Manual dispatch
// ---------------------------------------------------------------------------

const dispatchInputSchema = z.object({
  ref: githubRefSchema.optional(),
  inputs: workflowDispatchInputsSchema,
});

export async function dispatchGitHubWorkflow(
  workspaceId: string,
  projectId: string,
  input?: unknown,
): Promise<ActionResult<GitHubWorkflowDispatch>> {
  const parsed = dispatchInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);

    const limit = checkRateLimit(
      `github-dispatch:${workspaceId}`,
      undefined,
      DISPATCH_RATE_LIMIT,
      DISPATCH_RATE_WINDOW_MS,
    );
    if (!limit.allowed) {
      return {
        ok: false,
        error: `Dispatch rate limit reached for this workspace. Try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      };
    }

    const integration = await loadIntegration(supabase, workspaceId, projectId);
    if (!integration) return { ok: false, error: INTEGRATION_NOT_FOUND };
    if (!integration.enabled) {
      return { ok: false, error: "This GitHub integration is disabled." };
    }
    const secrets = await loadSecrets(integration.id);
    if (!secrets) return { ok: false, error: INTEGRATION_NOT_FOUND };

    const ref = parsed.data.ref ?? integration.default_ref;
    const inputs = parsed.data.inputs;

    // Record first, so a failed API call still leaves an audit trail.
    const { data: dispatchRow, error: insertError } = await supabase
      .from("github_workflow_dispatches")
      .insert({
        integration_id: integration.id,
        workspace_id: workspaceId,
        project_id: projectId,
        dispatched_by: userId,
        ref,
        inputs,
        status: "queued",
      })
      .select("id,status,conclusion,github_run_id,github_run_url,ref,error,created_at,updated_at")
      .single();
    if (insertError || !dispatchRow) return { ok: false, error: UNEXPECTED };
    const dispatch = dispatchRow as DispatchRow;

    try {
      await apiDispatch(secrets.token, {
        owner: integration.repo_owner,
        repo: integration.repo_name,
        workflowFile: integration.workflow_file,
        ref,
        inputs,
      });
    } catch (error) {
      const message = error instanceof GitHubApiError ? error.message : UNEXPECTED;
      // Dispatch state transitions are service-role writes (the
      // webhook is the other writer): members hold no UPDATE policy
      // on dispatches, so a forged status/conclusion via the table
      // API is impossible. Membership was proven above.
      const admin = createAdminClient();
      await admin
        .from("github_workflow_dispatches")
        .update({ status: "dispatch_failed", error: message })
        .eq("id", dispatch.id)
        .eq("workspace_id", workspaceId);
      return { ok: false, error: message };
    }

    revalidatePath(`/dashboard/projects/${projectId}/integrations`);
    return { ok: true, data: toDispatch(dispatch) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
