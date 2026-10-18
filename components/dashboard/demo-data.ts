/**
 * Sample data for the dashboard demo.
 *
 * IMPORTANT: every value here is fictional and hardcoded for UI preview
 * purposes only. Nothing on the dashboard represents a real executed test.
 * Replace with real data sources when the product backend exists.
 */

export type RunStatus = "passed" | "failed" | "skipped";

export interface DemoMetric {
  id: string;
  label: string;
  value: string;
  hint: string;
}

export interface DemoRun {
  id: string;
  name: string;
  project: string;
  status: RunStatus;
  duration: string;
  startedAgo: string;
}

export const DEMO_NOTICE =
  "Demo preview — every number on this page is sample data. No real browser tests have been executed.";

export const demoMetrics: DemoMetric[] = [
  { id: "total-runs", label: "Total runs", value: "128", hint: "sample, last 30 days" },
  { id: "pass-rate", label: "Pass rate", value: "87.5%", hint: "sample, last 30 days" },
  { id: "avg-duration", label: "Avg. duration", value: "42s", hint: "sample, per run" },
  { id: "active-projects", label: "Active projects", value: "6", hint: "sample" },
];

/** Consistent with demoMetrics: 112 + 11 + 5 = 128, 112/128 = 87.5%. */
export const demoStatusCounts: Record<RunStatus, number> = {
  passed: 112,
  failed: 11,
  skipped: 5,
};

export const demoPassRateTrend: number[] = [
  84, 88, 81, 90, 87, 92, 85, 89, 94, 88, 91, 86, 90, 87.5,
];

export const demoRecentRuns: DemoRun[] = [
  {
    id: "run-1",
    name: "Checkout flow",
    project: "Storefront",
    status: "passed",
    duration: "38s",
    startedAgo: "12 min ago",
  },
  {
    id: "run-2",
    name: "Login regression",
    project: "Storefront",
    status: "failed",
    duration: "51s",
    startedAgo: "1 hr ago",
  },
  {
    id: "run-3",
    name: "Search smoke",
    project: "Catalog",
    status: "passed",
    duration: "24s",
    startedAgo: "3 hrs ago",
  },
  {
    id: "run-4",
    name: "Payment edge cases",
    project: "Checkout",
    status: "skipped",
    duration: "—",
    startedAgo: "5 hrs ago",
  },
  {
    id: "run-5",
    name: "Onboarding tour",
    project: "Marketing site",
    status: "passed",
    duration: "47s",
    startedAgo: "Yesterday",
  },
  {
    id: "run-6",
    name: "API contract suite",
    project: "Platform API",
    status: "failed",
    duration: "1m 12s",
    startedAgo: "Yesterday",
  },
];

export const statusMeta: Record<
  RunStatus,
  { label: string; barClass: string; badgeClass: string }
> = {
  passed: {
    label: "Passed",
    barClass: "bg-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  },
  failed: {
    label: "Failed",
    barClass: "bg-red-500",
    badgeClass: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  },
  skipped: {
    label: "Skipped",
    barClass: "bg-amber-400",
    badgeClass: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  },
};
