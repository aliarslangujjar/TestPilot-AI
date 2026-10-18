import { demoRecentRuns, statusMeta } from "./demo-data";

/**
 * Recent test runs (sample data). Status is always conveyed as text,
 * never by color alone.
 */
export function RecentRunsTable() {
  return (
    <section
      aria-labelledby="recent-runs-heading"
      className="rounded-lg border bg-card p-5 shadow-sm"
    >
      <h2 id="recent-runs-heading" className="text-base font-semibold">
        Recent runs <span className="font-normal text-muted-foreground">(sample)</span>
      </h2>
      <div
        className="mt-4 overflow-x-auto"
        role="region"
        aria-label="Sample recent runs table, scrollable horizontally on small screens"
        tabIndex={0}
      >
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <caption className="sr-only">
            Sample list of recent test runs. No real browser tests have been executed.
          </caption>
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                Run
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Project
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Status
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Duration
              </th>
              <th scope="col" className="py-2 font-medium">
                Started
              </th>
            </tr>
          </thead>
          <tbody>
            {demoRecentRuns.map((run) => (
              <tr key={run.id} className="border-b last:border-0">
                <th scope="row" className="py-2.5 pr-4 font-medium">
                  {run.name}
                </th>
                <td className="py-2.5 pr-4 text-muted-foreground">{run.project}</td>
                <td className="py-2.5 pr-4">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusMeta[run.status].badgeClass}`}
                  >
                    {statusMeta[run.status].label}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{run.duration}</td>
                <td className="py-2.5 text-muted-foreground">{run.startedAgo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
