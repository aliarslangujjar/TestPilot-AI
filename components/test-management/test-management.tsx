"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { duplicateSuite, listSuites, setSuiteArchived } from "@/lib/suites/actions";
import type { Suite } from "@schemas/suite";
import { cn } from "@/lib/utils";

import { SuiteFormDialog } from "./suite-form-dialog";
import { TestCasePanel } from "./test-case-panel";

/**
 * Manual test management for one project: suites on the left, the selected
 * suite's test cases on the right. All data operations go through the
 * suite/test-case server actions, which enforce workspace permissions.
 */
export function TestManagement({
  workspaceId,
  projectId,
  projectName,
}: {
  workspaceId: string;
  projectId: string;
  projectName: string;
}) {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formTarget, setFormTarget] = useState<{ suite?: Suite } | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstRun = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  function flashNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }

  const load = useCallback(
    async (search: string, includeArchived: boolean, initial: boolean) => {
      if (initial) setLoading(true);
      setError(null);
      const result = await listSuites(workspaceId, projectId, {
        search: search ? search : undefined,
        includeArchived,
      });
      if (result.ok) {
        setSuites(result.data);
        // Keep the selection valid; auto-select the first suite on load.
        setSelectedId((prev) => {
          if (prev && result.data.some((s) => s.id === prev)) return prev;
          return result.data[0]?.id ?? null;
        });
      } else {
        setError(result.error);
      }
      setLoading(false);
    },
    [workspaceId, projectId],
  );

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      load("", showArchived, true);
      return;
    }
    const t = setTimeout(() => load(query.trim(), showArchived, false), 400);
    return () => clearTimeout(t);
  }, [query, showArchived, load]);

  async function handleArchive(suite: Suite, archived: boolean) {
    setBusy(true);
    setError(null);
    const result = await setSuiteArchived(workspaceId, projectId, suite.id, archived);
    setBusy(false);
    setConfirmingArchive(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flashNotice(archived ? `Suite “${suite.name}” archived.` : `Suite “${suite.name}” restored.`);
    load(query.trim(), showArchived, false);
  }

  async function handleDuplicate(suite: Suite) {
    setBusy(true);
    setError(null);
    const result = await duplicateSuite(workspaceId, projectId, suite.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flashNotice(`Suite “${suite.name}” duplicated.`);
    load(query.trim(), showArchived, false);
  }

  const selected = suites.find((s) => s.id === selectedId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{projectName}</p>
          <h1 className="text-2xl font-semibold">Test suites</h1>
        </div>
        <Button onClick={() => setFormTarget({})} disabled={busy}>
          New suite
        </Button>
      </div>

      {notice && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p role="status">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-medium underline-offset-4 hover:underline"
            aria-label="Dismiss notification"
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              load(query.trim(), showArchived, false);
            }}
            className="font-medium text-destructive underline-offset-4 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <section aria-label="Suites">
          <div className="flex items-center gap-2">
            <label htmlFor="suite-search" className="sr-only">
              Search suites
            </label>
            <input
              id="suite-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search suites…"
              autoComplete="off"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Show archived
          </label>

          <div className="mt-3">
            {loading ? (
              <div className="space-y-2" role="status" aria-label="Loading suites">
                {[0, 1].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-md border bg-muted/50" />
                ))}
              </div>
            ) : suites.length === 0 ? (
              <div className="rounded-lg border bg-card p-6 text-center">
                <p className="font-medium">No suites yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a suite to start organizing test cases.
                </p>
                <Button className="mt-4" size="sm" onClick={() => setFormTarget({})}>
                  Create suite
                </Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {suites.map((suite) => (
                  <li key={suite.id}>
                    <div
                      className={cn(
                        "rounded-lg border bg-card p-3",
                        selectedId === suite.id && "border-primary ring-1 ring-primary",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(suite.id)}
                        aria-pressed={selectedId === suite.id}
                        className="block w-full text-left"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{suite.name}</span>
                          {suite.isArchived && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              Archived
                            </span>
                          )}
                        </span>
                        {suite.description && (
                          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                            {suite.description}
                          </span>
                        )}
                      </button>
                      {confirmingArchive === suite.id ? (
                        <span className="mt-2 inline-flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Archive this suite?</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => handleArchive(suite, true)}
                          >
                            {busy ? "…" : "Confirm"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setConfirmingArchive(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="mt-2 inline-flex flex-wrap items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setFormTarget({ suite })}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => handleDuplicate(suite)}
                          >
                            Duplicate
                          </Button>
                          {suite.isArchived ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => handleArchive(suite, false)}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setConfirmingArchive(suite.id)}
                            >
                              Archive
                            </Button>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label="Test cases">
          {selected ? (
            <TestCasePanel
              workspaceId={workspaceId}
              projectId={projectId}
              suite={selected}
              notify={flashNotice}
              reportError={setError}
            />
          ) : (
            !loading && (
              <div className="rounded-lg border bg-card p-8 text-center">
                <p className="font-medium">Select a suite</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a suite on the left to manage its test cases.
                </p>
              </div>
            )
          )}
        </section>
      </div>

      {formTarget && (
        <SuiteFormDialog
          workspaceId={workspaceId}
          projectId={projectId}
          suite={formTarget.suite}
          onClose={() => setFormTarget(null)}
          onSaved={(saved, mode) => {
            setFormTarget(null);
            flashNotice(
              mode === "created"
                ? `Suite “${saved.name}” created.`
                : `Suite “${saved.name}” updated.`,
            );
            load(query.trim(), showArchived, false);
          }}
        />
      )}
    </div>
  );
}
