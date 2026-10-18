import { demoPassRateTrend } from "./demo-data";

const WIDTH = 560;
const HEIGHT = 180;
const PAD_X = 8;
const PAD_Y = 16;

/**
 * Lightweight SVG pass-rate trend chart (sample data).
 * Includes an accessible text summary and a <details> data table so the
 * values are available to screen readers and keyboard users.
 */
export function PassRateChart() {
  const points = demoPassRateTrend;
  const min = Math.min(...points);
  const max = Math.max(...points);

  const toX = (i: number) => PAD_X + (i / Math.max(points.length - 1, 1)) * (WIDTH - PAD_X * 2);
  const toY = (v: number) => HEIGHT - PAD_Y - ((v - 0) / (100 - 0)) * (HEIGHT - PAD_Y * 2);

  const line = points.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const area = `${PAD_X},${HEIGHT - PAD_Y} ${line} ${WIDTH - PAD_X},${HEIGHT - PAD_Y}`;

  return (
    <section
      aria-labelledby="pass-rate-heading"
      className="rounded-lg border bg-card p-5 shadow-sm"
    >
      <h2 id="pass-rate-heading" className="text-base font-semibold">
        Pass-rate trend{" "}
        <span className="font-normal text-muted-foreground">(sample, last 14 days)</span>
      </h2>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-4 h-auto w-full"
        role="img"
        aria-label={`Sample pass-rate trend over the last 14 days, ranging from ${min}% to ${max}%. No real tests have been executed.`}
      >
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={toY(g)}
              y2={toY(g)}
              className="stroke-muted"
              strokeWidth={1}
              strokeDasharray={g === 0 ? undefined : "4 4"}
            />
            <text
              x={WIDTH - PAD_X}
              y={toY(g) - 4}
              textAnchor="end"
              fontSize={10}
              className="fill-muted-foreground"
            >
              {g}%
            </text>
          </g>
        ))}
        <polygon points={area} className="fill-primary/10" aria-hidden="true" />
        <polyline
          points={line}
          fill="none"
          className="stroke-primary"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        />
        {points.map((v, i) => (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(v)}
            r={3.5}
            className="fill-primary"
            aria-hidden="true"
          >
            <title>{`Day ${i + 1}: ${v}%`}</title>
          </circle>
        ))}
      </svg>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-primary underline-offset-4 hover:underline">
          View trend data as a table
        </summary>
        <table className="mt-2 w-full border-collapse text-left">
          <caption className="sr-only">Sample pass-rate values for the last 14 days</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-1 pr-4 font-medium text-muted-foreground">
                Day
              </th>
              <th scope="col" className="py-1 font-medium text-muted-foreground">
                Pass rate
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((v, i) => (
              <tr key={i} className="border-b last:border-0">
                <th scope="row" className="py-1 pr-4 font-normal">
                  Day {i + 1}
                </th>
                <td className="py-1">{v}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
