import { RESOURCE_LABELS } from "@/lib/usage/limits";
import { cn } from "@/lib/utils";
import type { UsageAmounts, UsageSnapshot } from "@schemas/usage";

function formatValue(key: keyof UsageAmounts, value: number): string {
  if (key === "storageBytes") {
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (key === "executionSeconds") {
    if (value >= 3600) return `${(value / 3600).toFixed(1)} h`;
    if (value >= 60) return `${(value / 60).toFixed(1)} min`;
    return `${value} s`;
  }
  return value.toLocaleString();
}

function UsageBar({
  resource,
  used,
  limit,
}: {
  resource: keyof UsageAmounts;
  used: number;
  limit: number;
}) {
  const label = RESOURCE_LABELS[resource];
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const exhausted = used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">
          {formatValue(resource, used)} / {formatValue(resource, limit)} ({pct}%)
        </p>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn("h-full", exhausted ? "bg-destructive" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {exhausted && (
        <p className="mt-1 text-xs text-destructive">
          Limit reached for this period — new work of this kind is paused until the next period.
        </p>
      )}
    </div>
  );
}

const KEYS: Array<keyof UsageAmounts> = [
  "aiCalls",
  "browserRuns",
  "executionSeconds",
  "storageBytes",
];

export function UsageDashboard({ snapshot }: { snapshot: UsageSnapshot }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Usage</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Free plan usage for the current period ({snapshot.periodStart} to {snapshot.periodEnd},
        UTC). Limits reset each period. Usage is tracked as workspace totals only — no per-user
        breakdown is stored.
      </p>

      <section className="mt-6 grid gap-6 rounded-lg border p-4 sm:grid-cols-2">
        {KEYS.map((key) => (
          <UsageBar
            key={key}
            resource={key}
            used={snapshot.usage[key]}
            limit={snapshot.limits[key]}
          />
        ))}
      </section>

      {snapshot.history.length > 0 && (
        <section className="mt-8">
          <h2 className="font-medium">Previous periods</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">AI calls</th>
                  <th className="py-2 pr-4 font-medium">Browser runs</th>
                  <th className="py-2 pr-4 font-medium">Execution time</th>
                  <th className="py-2 font-medium">Storage</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.history.map((h) => (
                  <tr key={h.periodStart} className="border-b last:border-0">
                    <td className="py-2 pr-4">{h.periodStart}</td>
                    <td className="py-2 pr-4">{h.usage.aiCalls.toLocaleString()}</td>
                    <td className="py-2 pr-4">{h.usage.browserRuns.toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      {formatValue("executionSeconds", h.usage.executionSeconds)}
                    </td>
                    <td className="py-2">{formatValue("storageBytes", h.usage.storageBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
