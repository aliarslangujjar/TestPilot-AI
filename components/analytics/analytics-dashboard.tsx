"use client";

import { useCallback, useEffect, useState } from "react";

import { getAnalytics, type AnalyticsData } from "@/lib/analytics/actions";
import type { AnalyticsRange } from "@schemas/analytics";
import { cn } from "@/lib/utils";

import { PassRateChart } from "./pass-rate-chart";
import { ResultsChart } from "./results-chart";

const RANGES: AnalyticsRange[] = [7, 15, 30];

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-bold tracking-tight",
          accent && "text-amber-500 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * Analytics dashboard: real workspace aggregates only. Metric cards plus
 * per-day pass-rate and results charts over a selectable range.
 */
export function AnalyticsDashboard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [range, setRange] = useState<AnalyticsRange>(15);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (r: AnalyticsRange) => {
      setLoading(true);
      setError(null);
      const result = await getAnalytics(workspaceId, r);
      if (!result.ok) setError(result.error);
      else setData(result.data);
      setLoading(false);
    },
    [workspaceId],
  );

  useEffect(() => {
    load(range);
  }, [range, load]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {workspaceName} · execution health from real run data
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="analytics-range" className="text-muted-foreground">
            Range
          </label>
          <select
            id="analytics-range"
            value={range}
            onChange={(e) => setRange(Number(e.target.value) as AnalyticsRange)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>
                Last {r} days
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p role="alert" className="text-destructive">
            {error}{" "}
            <button
              type="button"
              onClick={() => load(range)}
              className="font-medium underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </p>
        </div>
      )}

      {loading || !data ? (
        <div
          className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Loading analytics"
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Total runs" value={String(data.totals.runs)} />
            <MetricCard label="Test cases" value={String(data.totals.testCases)} />
            <MetricCard
              label="Executions"
              value={String(data.totals.executions)}
              sub={`last ${data.range} days`}
            />
            <MetricCard
              label="Global pass rate"
              value={data.totals.passRate === null ? "—" : `${data.totals.passRate}%`}
              sub={
                data.totals.passRate === null
                  ? "no executions yet"
                  : `of ${data.totals.executions} executed`
              }
              accent
            />
            <MetricCard label="Test suites" value={String(data.totals.suites)} />
            <MetricCard
              label="Draft cases"
              value={String(data.totals.draftCases)}
              sub="not ready to run"
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border bg-card p-5" aria-label="Pass rate by day">
              <h2 className="font-semibold">Pass rate by day</h2>
              <p className="text-xs text-muted-foreground">Daily pass % over time</p>
              <div className="mt-3">
                <PassRateChart daily={data.daily} />
              </div>
            </section>
            <section className="rounded-lg border bg-card p-5" aria-label="Results by day">
              <h2 className="font-semibold">Results by day</h2>
              <p className="text-xs text-muted-foreground">Daily execution outcomes</p>
              <div className="mt-3">
                <ResultsChart daily={data.daily} />
              </div>
            </section>
          </div>

          {data.totals.executions === 0 && (
            <p className="mt-4 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              No executions in the last {data.range} days yet — charts will fill in as you run test
              cases.
            </p>
          )}
        </>
      )}
    </div>
  );
}
