"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { duplicateTestCase, listTestCases, setTestCaseArchived } from "@/lib/test-cases/actions";
import type { Suite } from "@schemas/suite";
import type { TestCase } from "@schemas/test-case";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/components/projects/project-detail-dialog";

import { TestCaseDetailDialog } from "./test-case-detail-dialog";
import { TestCaseFormDialog } from "./test-case-form-dialog";
import { GeneratePlanDialog } from "@/components/test-plans/generate-plan-dialog";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

const priorityStyles: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-100 text-blue-900",
  high: "bg-amber-100 text-amber-900",
  critical: "bg-red-100 text-red-900",
};

interface Filters {
  search: string;
  status: "" | TestCase["status"];
  priority: "" | TestCase["priority"];
  tag: string;
  showArchived: boolean;
}

const CLEAR_FILTERS: Filters = {
  search: "",
  status: "",
  priority: "",
  tag: "",
  showArchived: false,
};

/**
 * Test cases for the selected suite: search, status/priority/tag filters,
 * create, edit, duplicate, archive, and detail view.
 */
export function TestCasePanel({
  workspaceId,
  projectId,
  suite,
  notify,
  reportError,
}: {
  workspaceId: string;
  projectId: string;
  suite: Suite;
  notify: (message: string) => void;
  reportError: (message: string | null) => void;
}) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<Filters>(CLEAR_FILTERS);
  const [formTarget, setFormTarget] = useState<{ testCase?: TestCase } | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [viewing, setViewing] = useState<TestCase | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prevSuiteId = useRef(suite.id);
  const firstRun = useRef(true);

  const load = useCallback(
    async (f: Filters, initial: boolean) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      reportError(null);
      const result = await listTestCases(workspaceId, projectId, suite.id, {
        search: f.search ? f.search : undefined,
        status: f.status ? f.status : undefined,
        priority: f.priority ? f.priority : undefined,
        tags: f.tag ? [f.tag] : undefined,
        includeArchived: f.showArchived,
      });
      if (result.ok) {
        setCases(result.data);
      } else {
        reportError(result.error);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [workspaceId, projectId, suite.id, reportError],
  );

  // Suite change → reset filters and load immediately.
  // First run → load immediately. Filter changes → debounced reload.
  useEffect(() => {
    if (prevSuiteId.current !== suite.id) {
      prevSuiteId.current = suite.id;
      setFilters(CLEAR_FILTERS);
      setViewing(null);
      setConfirmingArchive(null);
      load(CLEAR_FILTERS, true);
      return;
    }
    if (firstRun.current) {
      firstRun.current = false;
      load(filters, true);
      return;
    }
    const t = setTimeout(() => load(filters, false), 400);
    return () => clearTimeout(t);
  }, [suite.id, filters, load]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function handleArchive(testCase: TestCase, archived: boolean) {
    setBusy(true);
    const result = await setTestCaseArchived(
      workspaceId,
      projectId,
      suite.id,
      testCase.id,
      archived,
    );
    setBusy(false);
    setConfirmingArchive(null);
    if (!result.ok) {
      reportError(result.error);
      return;
    }
    notify(
      archived
        ? `Test case “${testCase.title}” archived.`
        : `Test case “${testCase.title}” restored.`,
    );
    load(filters, false);
  }

  async function handleDuplicate(testCase: TestCase) {
    setBusy(true);
    const result = await duplicateTestCase(workspaceId, projectId, suite.id, testCase.id);
    setBusy(false);
    if (!result.ok) {
      reportError(result.error);
      return;
    }
    notify(`Test case “${testCase.title}” duplicated as draft.`);
    load(filters, false);
  }

  const allTags = Array.from(new Set(cases.flatMap((c) => c.tags))).sort();
  const isFiltering =
    filters.search !== "" ||
    filters.status !== "" ||
    filters.priority !== "" ||
    filters.tag !== "" ||
    filters.showArchived;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {suite.name}
          <span className="ml-2 text-sm font-normal text-muted-foreground">test cases</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowGenerate(true)} disabled={busy}>
            Generate with AI
          </Button>
          <Button size="sm" onClick={() => setFormTarget({})} disabled={busy}>
            New test case
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="case-search" className="sr-only">
            Search test cases
          </label>
          <input
            id="case-search"
            type="search"
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Search by title…"
            autoComplete="off"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label htmlFor="case-status" className="sr-only">
            Filter by status
          </label>
          <select
            id="case-status"
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value as Filters["status"])}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
          </select>
        </div>
        <div>
          <label htmlFor="case-priority" className="sr-only">
            Filter by priority
          </label>
          <select
            id="case-priority"
            value={filters.priority}
            onChange={(e) => setFilter("priority", e.target.value as Filters["priority"])}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0]?.toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="case-tag" className="sr-only">
            Filter by tag
          </label>
          <select
            id="case-tag"
            value={filters.tag}
            onChange={(e) => setFilter("tag", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={filters.showArchived}
            onChange={(e) => setFilter("showArchived", e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Show archived
        </label>
        {refreshing && (
          <span className="text-xs text-muted-foreground" role="status">
            Filtering…
          </span>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading test cases">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md border bg-muted/50" />
            ))}
          </div>
        ) : cases.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            {isFiltering ? (
              <>
                <p className="font-medium">No test cases match your filters</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different search or clear the filters.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">No test cases yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add the first manual test case for this suite.
                </p>
                <Button className="mt-4" size="sm" onClick={() => setFormTarget({})}>
                  New test case
                </Button>
              </>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {cases.map((testCase) => (
              <li key={testCase.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setViewing(testCase)}
                    className="text-left font-medium hover:underline"
                  >
                    {testCase.title}
                  </button>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        testCase.status === "active"
                          ? "bg-green-100 text-green-900"
                          : "bg-slate-100 text-slate-700",
                      )}
                    >
                      {testCase.status}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        priorityStyles[testCase.priority],
                      )}
                    >
                      {testCase.priority}
                    </span>
                    {testCase.isArchived && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Archived
                      </span>
                    )}
                  </span>
                </div>
                {testCase.tags.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {testCase.tags.map((t) => `#${t}`).join(" ")}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {testCase.steps.length} step{testCase.steps.length === 1 ? "" : "s"} · updated{" "}
                  {formatDateTime(testCase.updatedAt)}
                </p>
                {confirmingArchive === testCase.id ? (
                  <span className="mt-2 inline-flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Archive this test case? Its history is preserved.
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => handleArchive(testCase, true)}
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
                    <Button size="sm" variant="ghost" onClick={() => setViewing(testCase)}>
                      View
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setFormTarget({ testCase })}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => handleDuplicate(testCase)}
                    >
                      Duplicate
                    </Button>
                    {testCase.isArchived ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => handleArchive(testCase, false)}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirmingArchive(testCase.id)}
                      >
                        Archive
                      </Button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showGenerate && (
        <GeneratePlanDialog
          workspaceId={workspaceId}
          projectId={projectId}
          suiteId={suite.id}
          existingCases={cases.map((c) => ({ id: c.id, title: c.title }))}
          onClose={() => setShowGenerate(false)}
          onSaved={() => load(filters, false)}
        />
      )}

      {formTarget && (
        <TestCaseFormDialog
          workspaceId={workspaceId}
          projectId={projectId}
          suiteId={suite.id}
          testCase={formTarget.testCase}
          onClose={() => setFormTarget(null)}
          onSaved={(saved, mode) => {
            setFormTarget(null);
            setViewing(null);
            notify(
              mode === "created"
                ? `Test case “${saved.title}” created.`
                : `Test case “${saved.title}” updated.`,
            );
            load(filters, false);
          }}
        />
      )}

      {viewing && !formTarget && (
        <TestCaseDetailDialog
          testCase={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => setFormTarget({ testCase: viewing })}
        />
      )}
    </div>
  );
}
