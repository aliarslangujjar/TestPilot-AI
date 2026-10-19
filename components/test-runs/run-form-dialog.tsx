"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/projects/dialog";
import { listSuites } from "@/lib/suites/actions";
import { listTestCases } from "@/lib/test-cases/actions";
import { createRun, type TestRunWithSummary } from "@/lib/test-runs/actions";
import { createRunSchema } from "@schemas/test-run";
import type { Suite } from "@schemas/suite";
import type { TestCase } from "@schemas/test-case";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Create a test run from existing cases. Pick a suite, choose which of its
 * active cases to include (all by default), and every case is snapshotted
 * at creation so later edits never rewrite this run's history.
 */
export function RunFormDialog({
  workspaceId,
  projectId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  projectId: string;
  onClose: () => void;
  onCreated: (run: TestRunWithSummary) => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [suites, setSuites] = useState<Suite[]>([]);
  const [suiteId, setSuiteId] = useState("");
  const [cases, setCases] = useState<TestCase[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loadingSuites, setLoadingSuites] = useState(true);
  const [loadingCases, setLoadingCases] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadSuites() {
      const result = await listSuites(workspaceId, projectId, {});
      if (cancelled) return;
      setLoadingSuites(false);
      if (result.ok) {
        const active = result.data.filter((s) => !s.isArchived);
        setSuites(active);
        if (active.length > 0) setSuiteId(active[0]!.id);
      }
    }
    loadSuites();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, projectId]);

  useEffect(() => {
    if (!suiteId) {
      setCases([]);
      setChecked(new Set());
      return;
    }
    let cancelled = false;
    async function loadCases() {
      setLoadingCases(true);
      const result = await listTestCases(workspaceId, projectId, suiteId, {});
      if (cancelled) return;
      setLoadingCases(false);
      if (result.ok) {
        const active = result.data.filter((c) => !c.isArchived && c.status === "active");
        setCases(active);
        setChecked(new Set(active.map((c) => c.id)));
      }
    }
    loadCases();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, projectId, suiteId]);

  function toggleCase(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const parsed = createRunSchema.safeParse({
      name,
      suiteId: suiteId || undefined,
      testCaseIds: [...checked],
      notes: notes || undefined,
    });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      const result = await createRun(workspaceId, projectId, parsed.data);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      onCreated(result.data);
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="New test run" labelledBy="new-run-title" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {serverError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            {serverError}
          </p>
        )}

        <div>
          <label htmlFor="run-name" className="mb-1 block text-sm font-medium">
            Run name
          </label>
          <input
            id="run-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="Sprint 42 regression"
            className={cn(inputClass, fieldErrors.name && "border-destructive")}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? "run-name-error" : undefined}
          />
          {fieldErrors.name && (
            <p id="run-name-error" className="mt-1 text-xs text-destructive">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="run-suite" className="mb-1 block text-sm font-medium">
              Suite
            </label>
            <select
              id="run-suite"
              value={suiteId}
              onChange={(e) => setSuiteId(e.target.value)}
              disabled={loadingSuites}
              className={inputClass}
            >
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="run-notes" className="mb-1 block text-sm font-medium">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="run-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="What is this run covering?"
              className={inputClass}
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">
            Test cases{" "}
            <span className="font-normal text-muted-foreground">
              ({checked.size} of {cases.length} selected)
            </span>
          </legend>
          {loadingCases ? (
            <p className="text-sm text-muted-foreground" aria-label="Loading test cases">
              Loading test cases…
            </p>
          ) : cases.length === 0 ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              This suite has no active test cases. Activate cases in the suite before creating a
              run.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
              {cases.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={checked.has(c.id)}
                      onChange={() => toggleCase(c.id)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">{c.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.priority} · {c.steps.length} steps
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {fieldErrors.testCaseIds && (
            <p className="mt-1 text-xs text-destructive">{fieldErrors.testCaseIds}</p>
          )}
        </fieldset>

        <p className="text-xs text-muted-foreground">
          Each selected case is frozen as a snapshot — later edits won&apos;t change this run&apos;s
          history.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || loadingCases}>
            {pending ? "Creating…" : "Create run"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
