import { demoStatusCounts, statusMeta, type RunStatus } from "./demo-data";

const order: RunStatus[] = ["passed", "failed", "skipped"];

/**
 * Passed / failed / skipped breakdown as a labeled stacked bar plus a
 * text legend. Counts are sample data.
 */
export function StatusBreakdown() {
  const total = order.reduce((sum, key) => sum + demoStatusCounts[key], 0);
  const summary = order
    .map((key) => {
      const count = demoStatusCounts[key];
      const pct = total === 0 ? 0 : Math.round((count / total) * 100);
      return `${statusMeta[key].label} ${count} (${pct}%)`;
    })
    .join(", ");

  return (
    <section
      aria-labelledby="status-breakdown-heading"
      className="rounded-lg border bg-card p-5 shadow-sm"
    >
      <h2 id="status-breakdown-heading" className="text-base font-semibold">
        Run outcomes <span className="font-normal text-muted-foreground">(sample)</span>
      </h2>
      <div
        className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Sample run outcomes: ${summary}`}
      >
        {order.map((key) => {
          const pct = total === 0 ? 0 : (demoStatusCounts[key] / total) * 100;
          return (
            <div
              key={key}
              className={statusMeta[key].barClass}
              style={{ width: `${pct}%` }}
              aria-hidden="true"
            />
          );
        })}
      </div>
      <ul className="mt-4 space-y-2">
        {order.map((key) => {
          const count = demoStatusCounts[key];
          const pct = total === 0 ? 0 : Math.round((count / total) * 100);
          return (
            <li key={key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2.5 w-2.5 rounded-full ${statusMeta[key].barClass}`}
                />
                {statusMeta[key].label}
              </span>
              <span className="text-muted-foreground">
                {count} · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
