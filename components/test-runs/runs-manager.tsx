"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { listRuns, type TestRunWithSummary } from "@/lib/test-runs/actions";
import type { RunStatus } from "@schemas/test-run";
import { cn } from "@/lib/utils";

import { RunFormDialog } from "./run-form-dialog";

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        status === "completed" ? "bg-green-100 text-green-900" : "bg-blue-100 text-blue-900",
      )}
    >
      {status === "completed" ? "Completed" : "In progress"}
    </span>
  );
}

function SummaryLine({ run }: { run: TestRunWithSummary }) {
  const s = run.summary;
  return (
    <p className="text-xs text-muted-foreground">
      {s.total} cases · <span className="text-green-700">{s.pass} passed</span> ·{" "}
      <span className="text-red-700">{s.fail} failed</span>
      {s.blocked > 0 && (
        <>
          {" "}
          · <span className="text-amber-700">{s.blocked} blocked</span>
        </>
      )}
      {s.skipped > 0 && <> · {s.skipped} skipped</>}
      {s.unexecuted > 0 && <> · {s.unexecuted} unexecuted</>}
    </p>
  );
}

/**
 * Test-run history for a project: list, filter by status, create runs.
 * Summaries are computed server-side from run_results at read time.
 */
export function RunsManager({
  workspaceId,
  projectId,
  projectName,
}: {
  workspaceId: string;
  projectId: string;
  projectName: string;
}) {
  const [runs, setRuns] = useState<TestRunWithSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<"" | RunStatus>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const didMount = useRef(false);

  const load = useCallback(
    async (status: "" | RunStatus) => {
      setLoading(true);
      setError(null);
      const result = await listRuns(workspaceId, projectId, {
        status: status || undefined,
      });
      if (!result.ok) setError(result.error);
      else setRuns(result.data);
      setLoading(false);
    },
    [workspaceId, projectId],
  );

  // Mount loads unfiltered; later filter changes reload.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      load("");
      return;
    }
    load(statusFilter);
  }, [statusFilter, load]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/projects" className="underline-offset-4 hover:underline">
              Projects
            </Link>{" "}
            / {projectName}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Test runs</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/projects/${projectId}/suites`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Suites
          </Link>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            New run
          </Button>
        </div>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-900">
          {notice}
        </p>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p role="alert" className="text-destructive">
            {error}{" "}
            <button
              type="button"
              onClick={() => load(statusFilter)}
              className="font-medium underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm">
        <label htmlFor="run-status-filter" className="text-muted-foreground">
          Status
        </label>
        <select
          id="run-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | RunStatus)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">All</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3" aria-label="Loading test runs">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-4 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">No test runs yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Create a run to execute a set of test cases. Each case is frozen as a snapshot, so later
            edits never rewrite history.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setDialogOpen(true)}>
            New run
          </Button>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {runs.map((run) => (
            <li key={run.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/dashboard/projects/${projectId}/runs/${run.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {run.name}
                  </Link>
                  <StatusBadge status={run.status} />
                  <span
                    title="Manual run — automated execution is not built yet"
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                  >
                    Manual
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(run.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="mt-1">
                <SummaryLine run={run} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen && (
        <RunFormDialog
          workspaceId={workspaceId}
          projectId={projectId}
          onClose={() => setDialogOpen(false)}
          onCreated={(run) => {
            setDialogOpen(false);
            setNotice(`Run “${run.name}” created with ${run.summary.total} cases.`);
            load(statusFilter);
          }}
        />
      )}
    </div>
  );
}
