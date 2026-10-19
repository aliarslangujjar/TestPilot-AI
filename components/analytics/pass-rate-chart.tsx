import type { DailyPoint } from "@schemas/analytics";

const W = 640;
const H = 240;
const PAD = { l: 40, r: 16, t: 16, b: 32 };

/**
 * Pass-rate line chart. Days without executions break the line — they are
 * never plotted as 0%.
 */
export function PassRateChart({ daily }: { daily: DailyPoint[] }) {
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n = daily.length;

  const x = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.t + innerH - (v / 100) * innerH;

  const segments: string[] = [];
  let current: string[] = [];
  const points: Array<{ cx: number; cy: number; label: string; value: number }> = [];
  daily.forEach((d, i) => {
    if (d.passRate === null) {
      if (current.length > 1) segments.push(`M${current.join("L")}`);
      current = [];
      return;
    }
    const px = x(i);
    const py = y(d.passRate);
    current.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    points.push({ cx: px, cy: py, label: d.label, value: d.passRate });
  });
  if (current.length > 1) segments.push(`M${current.join("L")}`);

  const gridValues = [0, 25, 50, 75, 100];
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Pass rate by day line chart"
        className="w-full"
      >
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={PAD.l - 8}
              y={y(v) + 4}
              textAnchor="end"
              fontSize={11}
              className="fill-muted-foreground"
            >
              {v}%
            </text>
          </g>
        ))}
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {points.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={4} fill="var(--chart-1)">
            <title>{`${p.label}: ${p.value}%`}</title>
          </circle>
        ))}
        {daily.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={d.date}
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize={11}
              className="fill-muted-foreground"
            >
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
          View pass-rate data as a table
        </summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-4 font-medium">Day</th>
              <th className="py-1 font-medium">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date} className="border-t">
                <td className="py-1 pr-4">{d.label}</td>
                <td className="py-1">{d.passRate === null ? "—" : `${d.passRate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
