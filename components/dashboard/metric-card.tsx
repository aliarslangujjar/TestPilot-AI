import type { DemoMetric } from "./demo-data";

/**
 * A single labeled metric. Values shown here are sample data —
 * see the demo notice on the dashboard page.
 */
export function MetricCard({ metric }: { metric: DemoMetric }) {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
      <p
        className="mt-1 text-3xl font-bold tracking-tight"
        aria-label={`${metric.label}: ${metric.value} (${metric.hint})`}
      >
        {metric.value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
    </div>
  );
}
