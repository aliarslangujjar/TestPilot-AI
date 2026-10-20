"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  createPublicReport,
  listPublicReports,
  revokePublicReport,
} from "@/lib/public-reports/actions";
import type { PublicReportMeta } from "@schemas/public-report";
import { cn } from "@/lib/utils";

/**
 * Owner controls for public reports of one run: create an opt-in link
 * (token shown exactly once — only its hash is stored), list existing
 * reports, and revoke. Revocation takes effect on the next public read.
 */
export function ShareReportPanel({
  workspaceId,
  projectId,
  runId,
}: {
  workspaceId: string;
  projectId: string;
  runId: string;
}) {
  const [reports, setReports] = useState<PublicReportMeta[]>([]);
  const [includeDetails, setIncludeDetails] = useState(false);
  const [noIndex, setNoIndex] = useState(true);
  const [expiry, setExpiry] = useState<"" | "7" | "30">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const res = await listPublicReports(workspaceId, projectId, runId);
    if (res.ok) setReports(res.data);
  }

  useEffect(() => {
    void refresh();
  }, [workspaceId, projectId, runId]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await createPublicReport(workspaceId, projectId, runId, {
        includeFailureDetails: includeDetails,
        noIndex,
        expiresInDays: expiry === "" ? null : (Number(expiry) as 7 | 30),
      });
      if (res.ok) {
        setNewLink(`${window.location.origin}${res.data.path}`);
        await refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Could not create the report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(reportId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await revokePublicReport(workspaceId, projectId, reportId);
      if (res.ok) await refresh();
      else setError(res.error);
    } catch {
      setError("Could not revoke the report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function statusOf(r: PublicReportMeta): string {
    if (r.revokedAt) return "revoked";
    if (r.expiresAt && Date.parse(r.expiresAt) <= Date.now()) return "expired";
    return "active";
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-medium">Public report</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Share a read-only summary of this run via an unguessable link. Only the summary below is
        shared — no logs, artifacts, or workspace data. Links can be revoked at any time.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            className="accent-primary"
            checked={includeDetails}
            onChange={(e) => setIncludeDetails(e.target.checked)}
          />
          Include sanitized failure details (expected vs. actual)
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            className="accent-primary"
            checked={noIndex}
            onChange={(e) => setNoIndex(e.target.checked)}
          />
          Ask search engines not to index (noindex)
        </label>
        <label className="inline-flex items-center gap-1.5">
          Expires
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as "" | "7" | "30")}
            aria-label="Link expiry"
          >
            <option value="">Never</option>
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
          </select>
        </label>
        <Button size="sm" disabled={busy} onClick={handleCreate}>
          {busy ? "Working…" : "Create public link"}
        </Button>
      </div>

      {newLink && (
        <div className="mt-3 rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">Your public link — copy it now.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            For security, only a hash of this link is stored, so it cannot be shown again. Create a
            new link if you lose it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={newLink}
              aria-label="Public report link"
              className="w-full max-w-xl rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(newLink);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {reports.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {reports.map((r) => {
            const status = statusOf(r);
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2 border-t border-border pt-2"
              >
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    status === "active"
                      ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                  )}
                >
                  {status}
                </span>
                <span className="text-muted-foreground">
                  created {new Date(r.createdAt).toLocaleString()} · {r.viewCount} view
                  {r.viewCount === 1 ? "" : "s"}
                  {r.includeFailureDetails ? " · with failure details" : ""}
                  {r.noIndex ? " · noindex" : ""}
                  {r.expiresAt ? ` · expires ${new Date(r.expiresAt).toLocaleDateString()}` : ""}
                </span>
                {status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => handleRevoke(r.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
