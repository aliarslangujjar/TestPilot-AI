"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  completeRun,
  reopenRun,
  setResultOutcome,
  type TestRunWithSummary,
} from "@/lib/test-runs/actions";
import {
  resultOutcomeSchema,
  type ResultOutcome,
  type RunResult,
  type RunSummary,
} from "@schemas/test-run";
import { formatDateTime } from "@/components/projects/project-detail-dialog";
import { cn } from "@/lib/utils";

const OUTCOMES: ResultOutcome[] = ["unexecuted", "pass", "fail", "blocked", "skipped"];

function outcomeStyle(outcome: ResultOutcome): string {
  switch (outcome) {
    case "pass":
      return "bg-green-100 text-green-900";
    case "fail":
      return "bg-red-100 text-red-900";
    case "blocked":
      return "bg-amber-100 text-amber-900";
    case "skipped":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function computeSummary(results: RunResult[]): RunSummary {
  const summary: RunSummary = {
    total: results.length,
    unexecuted: 0,
    pass: 0,
    fail: 0,
    blocked: 0,
    skipped: 0,
  };
  for (const r of results) summary[r.outcome] += 1;
  return summary;
}

function SummaryBar({ summary }: { summary: RunSummary }) {
  const executed = summary.total - summary.unexecuted;
  const passRate = executed > 0 ? Math.round((summary.pass / executed) * 100) : null;
  const items: Array<{ label: string; value: number; className: string }> = [
    { label: "Passed", value: summary.pass, className: "text-green-700" },
    { label: "Failed", value: summary.fail, className: "text-red-700" },
    { label: "Blocked", value: summary.blocked, className: "text-amber-700" },
    { label: "Skipped", value: summary.skipped, className: "text-slate-600" },
    { label: "Unexecuted", value: summary.unexecuted, className: "text-slate-500" },
  ];
  return (
    <div className="mt-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <p className="text-sm">
          <span className="font-semibold text-lg">{summary.total}</span>{" "}
          <span className="text-muted-foreground">cases</span>
        </p>
        {items.map((item) => (
          <p key={item.label} className="text-sm">
            <span className={cn("font-semibold", item.className)}>{item.value}</span>{" "}
            <span className="text-muted-foreground">{item.label.toLowerCase()}</span>
          </p>
        ))}
        {passRate !== null && (
          <p className="text-sm">
            <span className="font-semibold">{passRate}%</span>{" "}
            <span className="text-muted-foreground">pass rate of executed</span>
          </p>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  workspaceId,
  projectId,
  runId,
  result,
  locked,
  onSaved,
}: {
  workspaceId: string;
  projectId: string;
  runId: string;
  result: RunResult;
  locked: boolean;
  onSaved: (updated: RunResult) => void;
}) {
  const [outcome, setOutcome] = useState<ResultOutcome>(result.outcome);
  const [notes, setNotes] = useState(result.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const dirty = outcome !== result.outcome || notes !== (result.notes ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await setResultOutcome(workspaceId, projectId, runId, result.id, {
        outcome,
        notes: notes || undefined,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        onSaved(res.data);
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 2000);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const snapshot = result.snapshot;

  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{snapshot.title}</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            outcomeStyle(result.outcome),
          )}
        >
          {result.outcome}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {snapshot.priority} priority
        {snapshot.tags.length > 0 && <> · {snapshot.tags.map((t) => `#${t}`).join(" ")}</>}
        {result.executedAt && <> · ran {formatDateTime(result.executedAt)}</>}
      </p>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
          View frozen steps ({snapshot.steps.length})
        </summary>
        <div className="mt-2 space-y-2 rounded-md bg-muted/40 p-3">
          {snapshot.preconditions && (
            <p className="text-xs">
              <span className="font-medium">Preconditions:</span> {snapshot.preconditions}
            </p>
          )}
          {snapshot.steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">No steps recorded.</p>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-5 text-xs">
              {snapshot.steps.map((step, i) => (
                <li key={i}>
                  <p>{step.action}</p>
                  {step.expected && (
                    <p className="text-muted-foreground">Expected: {step.expected}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {snapshot.expectedResults && (
            <p className="text-xs">
              <span className="font-medium">Expected results:</span> {snapshot.expectedResults}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Snapshot taken when the run was created — later case edits don&apos;t change this.
          </p>
        </div>
      </details>

      {locked ? (
        <p className="mt-3 text-xs text-muted-foreground">
          This run is completed. Reopen it to change results.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <div>
            <label
              htmlFor={`outcome-${result.id}`}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Outcome
            </label>
            <select
              id={`outcome-${result.id}`}
              value={outcome}
              onChange={(e) => setOutcome(resultOutcomeSchema.parse(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`notes-${result.id}`}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Notes
            </label>
            <input
              id={`notes-${result.id}`}
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="What happened?"
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            {savedTick && (
              <span role="status" className="text-xs text-green-700">
                Saved
              </span>
            )}
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {result.notes && (
        <p className="mt-2 border-l-2 pl-2 text-xs text-muted-foreground">{result.notes}</p>
      )}
    </li>
  );
}

/**
 * Run detail: summary, complete/reopen, and per-result execution against
 * the frozen snapshots.
 */
export function RunDetailManager({
  workspaceId,
  projectId,
  projectName,
  initialRun,
  initialResults,
}: {
  workspaceId: string;
  projectId: string;
  projectName: string;
  initialRun: TestRunWithSummary;
  initialResults: RunResult[];
}) {
  const [run, setRun] = useState(initialRun);
  const [results, setResults] = useState(initialResults);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const locked = run.status === "completed";
  const summary = computeSummary(results);

  async function changeState(action: "complete" | "reopen") {
    setActionPending(true);
    setActionError(null);
    try {
      const res =
        action === "complete"
          ? await completeRun(workspaceId, projectId, run.id)
          : await reopenRun(workspaceId, projectId, run.id);
      if (!res.ok) setActionError(res.error);
      else setRun(res.data);
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard/projects" className="underline-offset-4 hover:underline">
          Projects
        </Link>{" "}
        /{" "}
        <Link
          href={`/dashboard/projects/${projectId}/runs`}
          className="underline-offset-4 hover:underline"
        >
          Test runs
        </Link>{" "}
        / {projectName}
      </p>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{run.name}</h1>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              locked ? "bg-green-100 text-green-900" : "bg-blue-100 text-blue-900",
            )}
          >
            {locked ? "Completed" : "In progress"}
          </span>
          <span
            title="Manual run — automated execution is not built yet"
            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
          >
            Manual
          </span>
        </div>
        {locked ? (
          <Button
            variant="outline"
            size="sm"
            disabled={actionPending}
            onClick={() => changeState("reopen")}
          >
            {actionPending ? "Reopening…" : "Reopen run"}
          </Button>
        ) : (
          <Button size="sm" disabled={actionPending} onClick={() => changeState("complete")}>
            {actionPending ? "Completing…" : "Complete run"}
          </Button>
        )}
      </div>

      {run.notes && <p className="mt-2 text-sm text-muted-foreground">{run.notes}</p>}
      {actionError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      <SummaryBar summary={summary} />

      {results.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">This run has no results.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {results.map((result) => (
            <ResultCard
              key={result.id}
              workspaceId={workspaceId}
              projectId={projectId}
              runId={run.id}
              result={result}
              locked={locked}
              onSaved={(updated) =>
                setResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
              }
            />
          ))}
        </ul>
      )}

      <div className="mt-8">
        <Link
          href={`/dashboard/projects/${projectId}/runs`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to runs
        </Link>
      </div>
    </div>
  );
}
