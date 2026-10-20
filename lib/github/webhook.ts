import { createHmac, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

import { createGitHubCommitStatus } from "./client";
import { decryptSecret } from "./crypto";

/**
 * GitHub webhook handler for the Actions integration.
 *
 * Authenticity: every delivery is HMAC-SHA256 verified against the
 * per-integration webhook secret before anything is trusted. With
 * several integrations pointing at one repository, the secret that
 * verifies identifies the integration.
 *
 * Duplicate protection: GitHub's X-GitHub-Delivery id is recorded
 * before processing; a redelivery of the same id is a no-op.
 *
 * Only workflow_run events for the mapped workflow file affect
 * dispatches. Runs started outside TestPilot (e.g. from the GitHub UI)
 * are acknowledged and ignored — we only track our own dispatches.
 */

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

interface IntegrationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  repo_owner: string;
  repo_name: string;
  workflow_file: string;
  enabled: boolean;
}

interface DispatchRow {
  id: string;
  status: string;
  github_run_id: number | null;
  status_published: boolean;
}

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(header.slice("sha256=".length), "hex");
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function mapRunStatus(githubStatus: string): string | null {
  switch (githubStatus) {
    case "queued":
    case "requested":
    case "waiting":
      return "requested";
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    default:
      return null;
  }
}

function conclusionToState(conclusion: string | null): "success" | "failure" | "error" {
  if (conclusion === "success") return "success";
  if (conclusion === "failure") return "failure";
  return "error";
}

interface WorkflowRunPayload {
  repository?: { full_name?: string };
  workflow?: { path?: string };
  workflow_run?: {
    id?: number;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
    head_sha?: string;
    created_at?: string;
  };
}

export async function handleGitHubWebhook(input: {
  rawBody: string;
  signature: string | null;
  deliveryId: string | null;
  event: string | null;
}): Promise<WebhookResult> {
  const { rawBody, signature, deliveryId, event } = input;
  if (!deliveryId) return { status: 400, body: { error: "Missing delivery id." } };
  if (!event) return { status: 400, body: { error: "Missing event type." } };

  let payload: WorkflowRunPayload;
  try {
    payload = JSON.parse(rawBody) as WorkflowRunPayload;
  } catch {
    return { status: 400, body: { error: "Invalid JSON body." } };
  }

  const fullName = payload.repository?.full_name;
  if (!fullName || !fullName.includes("/")) {
    return { status: 400, body: { error: "Missing repository." } };
  }
  const [owner, repo] = fullName.split("/", 2) as [string, string];

  const admin = createAdminClient();

  const { data: candidates } = await admin
    .from("github_integrations")
    .select("id,workspace_id,project_id,repo_owner,repo_name,workflow_file,enabled")
    .ilike("repo_owner", escapeIlike(owner))
    .ilike("repo_name", escapeIlike(repo));
  const integrations = (candidates ?? []) as IntegrationRow[];
  if (integrations.length === 0) {
    // Uniform with the invalid-signature response below: the endpoint
    // must not reveal which repositories have integrations configured
    // (that distinction was an enumeration oracle).
    return { status: 401, body: { error: "Invalid signature." } };
  }

  // The webhook secret that verifies identifies the integration.
  let matched: { integration: IntegrationRow; token: string } | null = null;
  for (const integration of integrations) {
    const { data: secretRow } = await admin
      .from("github_integration_secrets")
      .select("token_encrypted,webhook_secret_encrypted")
      .eq("integration_id", integration.id)
      .maybeSingle();
    if (!secretRow) continue;
    const row = secretRow as { token_encrypted: string; webhook_secret_encrypted: string };
    let webhookSecret: string;
    try {
      webhookSecret = decryptSecret(row.webhook_secret_encrypted);
    } catch {
      continue;
    }
    if (verifySignature(webhookSecret, rawBody, signature)) {
      matched = { integration, token: decryptSecret(row.token_encrypted) };
      break;
    }
  }
  if (!matched) {
    return { status: 401, body: { error: "Invalid signature." } };
  }
  const { integration, token } = matched;

  // Duplicate-event protection: record the delivery before processing.
  const { error: deliveryError } = await admin
    .from("github_webhook_deliveries")
    .insert({ delivery_id: deliveryId, event });
  if (deliveryError) {
    if ((deliveryError as { code?: string }).code === "23505") {
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    return { status: 500, body: { error: "Could not record delivery." } };
  }

  if (event === "ping") return { status: 200, body: { ok: true } };
  if (event !== "workflow_run") {
    return { status: 202, body: { ok: true, ignored: "event" } };
  }
  if (!integration.enabled) {
    return { status: 202, body: { ok: true, ignored: "integration disabled" } };
  }

  const run = payload.workflow_run ?? {};
  const workflowPath = payload.workflow?.path ?? "";
  const workflowFile = workflowPath.split("/").pop() ?? "";
  if (workflowFile !== integration.workflow_file) {
    return { status: 202, body: { ok: true, ignored: "workflow" } };
  }
  const mappedStatus = run.status ? mapRunStatus(run.status) : null;
  if (!mappedStatus || typeof run.id !== "number") {
    return { status: 202, body: { ok: true, ignored: "status" } };
  }

  // Correlate: by recorded run id, else the oldest unmatched dispatch.
  let dispatch: DispatchRow | null | undefined;
  const { data: byRun } = await admin
    .from("github_workflow_dispatches")
    .select("id,status,github_run_id,status_published")
    .eq("integration_id", integration.id)
    .eq("github_run_id", run.id)
    .maybeSingle();
  if (byRun) {
    dispatch = byRun as DispatchRow;
  } else {
    const { data: queued } = await admin
      .from("github_workflow_dispatches")
      .select("id,status,github_run_id,status_published")
      .eq("integration_id", integration.id)
      .is("github_run_id", null)
      .in("status", ["queued", "requested", "in_progress"])
      .order("created_at", { ascending: true })
      .limit(1);
    dispatch = ((queued ?? []) as DispatchRow[])[0] ?? null;
  }
  if (!dispatch) {
    // A run we did not dispatch (started from the GitHub UI) — not tracked.
    return { status: 202, body: { ok: true, ignored: "no matching dispatch" } };
  }

  const patch: Record<string, unknown> = {
    status: mappedStatus,
    github_run_id: run.id,
    // The run URL is rendered as an href in the dashboard. Only accept
    // https URLs from the payload — a webhook-secret holder must not
    // be able to store a javascript: URL another member clicks.
    github_run_url:
      typeof run.html_url === "string" && run.html_url.startsWith("https://") ? run.html_url : null,
    head_sha: run.head_sha ?? null,
  };
  if (mappedStatus === "completed") patch.conclusion = run.conclusion ?? null;
  await admin.from("github_workflow_dispatches").update(patch).eq("id", dispatch.id);

  // Publish the result back to GitHub as a commit status whose target is
  // the authorized TestPilot project page. Best-effort by design.
  if (mappedStatus === "completed" && !dispatch.status_published && run.head_sha) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      try {
        await createGitHubCommitStatus(token, {
          owner: integration.repo_owner,
          repo: integration.repo_name,
          sha: run.head_sha,
          state: conclusionToState(run.conclusion ?? null),
          targetUrl: `${appUrl.replace(/\/$/, "")}/dashboard/projects/${integration.project_id}`,
          description: `TestPilot QA workflow finished: ${run.conclusion ?? "unknown"}`,
        });
        await admin
          .from("github_workflow_dispatches")
          .update({ status_published: true })
          .eq("id", dispatch.id);
      } catch {
        // Publishing must never fail the webhook; a manual redelivery
        // (new delivery id) can retry it.
      }
    }
  }

  return { status: 200, body: { ok: true } };
}
