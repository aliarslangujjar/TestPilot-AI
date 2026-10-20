"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  deleteGitHubIntegration,
  dispatchGitHubWorkflow,
  listGitHubWorkflowDispatches,
  saveGitHubIntegration,
  setGitHubIntegrationEnabled,
} from "@/lib/github/actions";
import type { GitHubIntegration, GitHubWorkflowDispatch } from "@schemas/github";

interface PanelProps {
  workspaceId: string;
  projectId: string;
  projectName: string;
  initialIntegration: GitHubIntegration | null;
  initialDispatches: GitHubWorkflowDispatch[];
}

const inputClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-xs font-medium text-muted-foreground";

function statusLabel(d: GitHubWorkflowDispatch): string {
  if (d.status === "completed") return `completed · ${d.conclusion ?? "unknown"}`;
  if (d.status === "dispatch_failed") return "dispatch failed";
  return d.status.replace("_", " ");
}

export function GitHubIntegrationPanel({
  workspaceId,
  projectId,
  projectName,
  initialIntegration,
  initialDispatches,
}: PanelProps) {
  const [integration, setIntegration] = useState(initialIntegration);
  const [dispatches, setDispatches] = useState(initialDispatches);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Connect / edit form
  const [owner, setOwner] = useState(initialIntegration?.repoOwner ?? "");
  const [repo, setRepo] = useState(initialIntegration?.repoName ?? "");
  const [workflowFile, setWorkflowFile] = useState(initialIntegration?.workflowFile ?? "qa.yml");
  const [defaultRef, setDefaultRef] = useState(initialIntegration?.defaultRef ?? "main");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");

  // Dispatch form
  const [refOverride, setRefOverride] = useState("");
  const [inputRows, setInputRows] = useState<Array<{ key: string; value: string }>>([
    { key: "", value: "" },
  ]);
  const [dispatching, setDispatching] = useState(false);

  async function refreshDispatches() {
    const res = await listGitHubWorkflowDispatches(workspaceId, projectId);
    if (res.ok) setDispatches(res.data);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await saveGitHubIntegration(workspaceId, projectId, {
      repoOwner: owner.trim(),
      repoName: repo.trim(),
      workflowFile: workflowFile.trim(),
      defaultRef: defaultRef.trim() || "main",
      ...(token.trim() ? { token: token.trim() } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setIntegration(res.data.integration);
    setToken("");
    setNotice("Integration saved and verified against the GitHub API.");
    if (res.data.webhookSecret) {
      setWebhookSecret(res.data.webhookSecret);
      setWebhookUrl(`${window.location.origin}/api/integrations/github/webhook`);
    }
  }

  async function handleToggle() {
    if (!integration) return;
    const res = await setGitHubIntegrationEnabled(workspaceId, projectId, !integration.enabled);
    if (res.ok) setIntegration({ ...integration, enabled: res.data.enabled });
    else setError(res.error);
  }

  async function handleDelete() {
    const res = await deleteGitHubIntegration(workspaceId, projectId);
    if (res.ok) {
      setIntegration(null);
      setDispatches([]);
      setWebhookSecret(null);
      setNotice("Integration removed. The stored token and webhook secret were deleted.");
    } else {
      setError(res.error);
    }
  }

  async function handleDispatch() {
    setDispatching(true);
    setError(null);
    setNotice(null);
    const inputs: Record<string, string> = {};
    for (const row of inputRows) {
      if (row.key.trim()) inputs[row.key.trim()] = row.value;
    }
    const res = await dispatchGitHubWorkflow(workspaceId, projectId, {
      ...(refOverride.trim() ? { ref: refOverride.trim() } : {}),
      inputs,
    });
    setDispatching(false);
    if (res.ok) {
      setNotice("Workflow dispatch sent. Status will update here as GitHub reports progress.");
      await refreshDispatches();
    } else {
      setError(res.error);
      await refreshDispatches();
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">GitHub Actions</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Connect {projectName} to a GitHub Actions workflow and dispatch runs manually. TestPilot
        only calls the GitHub API — it never clones or runs repository code. Tokens are encrypted at
        rest and never shown again after saving.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && <p className="mt-4 text-sm text-muted-foreground">{notice}</p>}

      <section className="mt-6 rounded-lg border p-4">
        <h2 className="font-medium">
          {integration ? "Repository mapping" : "Connect a repository"}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="gh-owner" className={labelClass}>
              Repository owner
            </label>
            <input
              id="gh-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="your-org"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="gh-repo" className={labelClass}>
              Repository name
            </label>
            <input
              id="gh-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="your-repo"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="gh-workflow" className={labelClass}>
              Workflow file (in .github/workflows/)
            </label>
            <input
              id="gh-workflow"
              value={workflowFile}
              onChange={(e) => setWorkflowFile(e.target.value)}
              placeholder="qa.yml"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="gh-ref" className={labelClass}>
              Default ref (branch or tag)
            </label>
            <input
              id="gh-ref"
              value={defaultRef}
              onChange={(e) => setDefaultRef(e.target.value)}
              placeholder="main"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="gh-token" className={labelClass}>
              Fine-grained access token{" "}
              {integration ? "(leave blank to keep the stored token)" : "(required)"}
            </label>
            <input
              id="gh-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              Scope the token to this one repository: Actions (read &amp; write) and Metadata
              (read). Add Commit statuses (read &amp; write) if you want TestPilot to publish the
              result back onto the commit. See docs/GITHUB_ACTIONS.md.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Verifying…" : integration ? "Save mapping" : "Connect repository"}
          </Button>
          {integration && (
            <>
              <Button type="button" variant="outline" onClick={() => void handleToggle()}>
                {integration.enabled ? "Disable" : "Enable"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void handleDelete()}>
                Disconnect
              </Button>
            </>
          )}
        </div>
        {integration && (
          <p className="mt-3 text-xs text-muted-foreground">
            Connected: {integration.repoOwner}/{integration.repoName} · {integration.workflowFile} ·
            ref {integration.defaultRef} · {integration.enabled ? "enabled" : "disabled"} · token
            stored (encrypted)
          </p>
        )}
      </section>

      {webhookSecret && (
        <section className="mt-6 rounded-lg border border-amber-500/50 p-4">
          <h2 className="font-medium">Finish the webhook setup in GitHub</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            In your repository: Settings → Webhooks → Add webhook. Paste the URL and secret below,
            choose <em>application/json</em>, and subscribe to <strong>Workflow runs</strong>{" "}
            events. The secret is shown only once — TestPilot stores it encrypted and cannot show it
            again.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <label className={labelClass} htmlFor="gh-webhook-url">
              Payload URL
            </label>
            <input id="gh-webhook-url" readOnly value={webhookUrl} className={inputClass} />
            <label className={labelClass} htmlFor="gh-webhook-secret">
              Webhook secret (shown once)
            </label>
            <input id="gh-webhook-secret" readOnly value={webhookSecret} className={inputClass} />
          </div>
        </section>
      )}

      {integration && (
        <section className="mt-6 rounded-lg border p-4">
          <h2 className="font-medium">Run the workflow</h2>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="gh-dispatch-ref" className={labelClass}>
                Ref (blank = default {integration.defaultRef})
              </label>
              <input
                id="gh-dispatch-ref"
                value={refOverride}
                onChange={(e) => setRefOverride(e.target.value)}
                placeholder={integration.defaultRef}
                className={inputClass}
              />
            </div>
            {inputRows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  aria-label={`Input name ${i + 1}`}
                  value={row.key}
                  onChange={(e) =>
                    setInputRows((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                    )
                  }
                  placeholder="input name"
                  className={inputClass}
                />
                <input
                  aria-label={`Input value ${i + 1}`}
                  value={row.value}
                  onChange={(e) =>
                    setInputRows((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  placeholder="value"
                  className={inputClass}
                />
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={inputRows.length >= 5}
                onClick={() => setInputRows((prev) => [...prev, { key: "", value: "" }])}
              >
                Add input
              </Button>
            </div>
            <div>
              <Button
                type="button"
                disabled={dispatching || !integration.enabled}
                onClick={() => void handleDispatch()}
              >
                {dispatching ? "Dispatching…" : "Dispatch workflow"}
              </Button>
              {!integration.enabled && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This integration is disabled — enable it to dispatch.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {dispatches.length > 0 && (
        <section className="mt-6">
          <h2 className="font-medium">Recent dispatches</h2>
          <ul className="mt-3 space-y-2">
            {dispatches.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {statusLabel(d)}{" "}
                    <span className="font-normal text-muted-foreground">on {d.ref}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(d.createdAt).toLocaleString()}
                  </p>
                  {d.error && <p className="text-xs text-destructive">{d.error}</p>}
                </div>
                {d.githubRunUrl && (
                  <a
                    href={d.githubRunUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline"
                  >
                    View in GitHub
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
