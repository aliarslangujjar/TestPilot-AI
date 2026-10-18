"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreateProjectDialog } from "./create-project-dialog";
import { DEMO_NOTICE, demoMetrics } from "./demo-data";
import { EmptyState } from "./empty-state";
import { MetricCard } from "./metric-card";
import { PassRateChart } from "./pass-rate-chart";
import { RecentRunsTable } from "./recent-runs-table";
import { StatusBreakdown } from "./status-breakdown";

type View = "sample" | "empty";

/**
 * Dashboard demo page. All data is hardcoded sample data (see demo-data.ts);
 * nothing here represents a real executed test.
 */
export function Dashboard() {
  const [view, setView] = useState<View>("sample");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdProjects, setCreatedProjects] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const handleCreateProject = (name: string) => {
    setCreatedProjects((prev) => [...prev, name]);
    setNotice(`Project "${name}" created (demo — not saved).`);
    setView("sample");
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {/* Demo notice + scenario preview toggle */}
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40"
        role="note"
        aria-label="Demo data notice"
      >
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{DEMO_NOTICE}</p>
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Preview scenario"
        >
          <span className="text-xs font-medium text-amber-800 uppercase tracking-wide dark:text-amber-200">
            Preview:
          </span>
          {(
            [
              { id: "sample", label: "Sample dashboard" },
              { id: "empty", label: "New-user empty state" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={view === option.id}
              onClick={() => {
                setView(option.id);
                setNotice(null);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === option.id
                  ? "border-amber-900 bg-amber-900 text-amber-50 dark:border-amber-100 dark:bg-amber-100 dark:text-amber-950"
                  : "border-amber-300 bg-transparent text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900/40",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          {notice}
        </p>
      )}

      {view === "empty" ? (
        <div className="mt-8">
          <EmptyState onCreate={() => setDialogOpen(true)} />
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sample overview of test activity.
                {createdProjects.length > 0 && (
                  <span className="ml-1">
                    {createdProjects.length} project{createdProjects.length === 1 ? "" : "s"}{" "}
                    created this session (demo).
                  </span>
                )}
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>New project</Button>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {demoMetrics.map((metric) => (
              <MetricCard key={metric.id} metric={metric} />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <StatusBreakdown />
            <PassRateChart />
          </div>

          <div className="mt-4">
            <RecentRunsTable />
          </div>
        </>
      )}

      <CreateProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreateProject}
      />
    </main>
  );
}
