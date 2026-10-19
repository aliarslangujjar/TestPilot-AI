import type { DailyPoint } from "@schemas/analytics";

const W = 640;
const H = 240;
const PAD = { l: 40, r: 16, t: 16, b: 32 };

const SERIES: Array<{
  key: "pass" | "fail" | "blocked" | "skipped";
  label: string;
  color: string;
}> = [
  { key: "pass", label: "Passed", color: "var(--chart-2)" },
  { key: "fail", label: "Failed", color: "var(--destructive)" },
  { key: "blocked", label: "Blocked", color: "var(--chart-4)" },
  { key: "skipped", label: "Skipped", color: "var(--muted-foreground)" },
];

/** Stacked daily results, one bar per day. */
export function ResultsChart({ daily }: { daily: DailyPoint[] }) {
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n = daily.length;
  const maxTotal = Math.max(1, ...daily.map((d) => d.total));

  const slotW = n > 0 ? innerW / n : innerW;
  const barW = Math.max(4, Math.min(36, slotW * 0.55));
  const x = (i: number) => PAD.l + slotW * i + (slotW - barW) / 2;
  const h = (v: number) => (v / maxTotal) * innerH;

  const labelEvery = Math.max(1, Math.ceil(n / 10));
  const gridSteps = 4;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Daily execution results stacked bar chart"
        className="w-full"
      >
        {Array.from({ length: gridSteps + 1 }, (_, g) => {
          const v = Math.round((maxTotal * g) / gridSteps);
          const yPos = PAD.t + innerH - (v / maxTotal) * innerH;
          return (
            <g key={g}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={yPos}
                y2={yPos}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <text
                x={PAD.l - 8}
                y={yPos + 4}
                textAnchor="end"
                fontSize={11}
                className="fill-muted-foreground"
              >
                {v}
              </text>
            </g>
          );
        })}
        {daily.map((d, i) => {
          let base = PAD.t + innerH;
          return (
            <g key={d.date}>
              {SERIES.map((s) => {
                const value = d[s.key];
                const bh = h(value);
                base -= bh;
                if (value === 0) return null;
                const rect = (
                  <rect x={x(i)} y={base} width={barW} height={bh} fill={s.color} rx={1}>
                    <title>{`${d.label} — ${s.label}: ${value}`}</title>
                  </rect>
                );
                return <g key={s.key}>{rect}</g>;
              })}
              {i % labelEvery === 0 && (
                <text
                  x={x(i) + barW / 2}
                  y={H - 10}
                  textAnchor="middle"
                  fontSize={11}
                  className="fill-muted-foreground"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
          View daily results as a table
        </summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-4 font-medium">Day</th>
              <th className="py-1 pr-4 font-medium">Passed</th>
              <th className="py-1 pr-4 font-medium">Failed</th>
              <th className="py-1 pr-4 font-medium">Blocked</th>
              <th className="py-1 font-medium">Skipped</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date} className="border-t">
                <td className="py-1 pr-4">{d.label}</td>
                <td className="py-1 pr-4">{d.pass}</td>
                <td className="py-1 pr-4">{d.fail}</td>
                <td className="py-1 pr-4">{d.blocked}</td>
                <td className="py-1">{d.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
