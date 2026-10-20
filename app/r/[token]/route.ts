import { resolvePublicReport } from "@/lib/public-reports/access";
import { isSnapshotStale } from "@/lib/public-reports/snapshot";
import type { PublicReportSnapshot } from "@schemas/public-report";

/**
 * Public, read-only QA report page: GET /r/<token>.
 *
 * A route handler (not a page component) so response headers are fully
 * controlled: no-store caching, no-referrer, a strict CSP with sandbox,
 * optional no-index, 404 for unknown/revoked/expired (indistinguishable),
 * and 429 with Retry-After when rate-limited. All snapshot text is
 * HTML-escaped — titles are user-authored content.
 */

export const dynamic = "force-dynamic";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toUTCString();
}

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
};

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 760px; padding: 0 1rem; color: #111; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .meta { color: #555; font-size: 0.9rem; }
  .stale { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 0.5rem 0.75rem; margin: 1rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.95rem; }
  th { background: #f8fafc; }
  .detail { background: #f8fafc; border-radius: 6px; padding: 0.5rem 0.75rem; margin: 0.5rem 0 1rem; font-size: 0.95rem; }
  footer { color: #666; font-size: 0.85rem; margin-top: 2rem; border-top: 1px solid #eee; padding-top: 0.75rem; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function renderReport(snapshot: PublicReportSnapshot, now: Date): string {
  const s = snapshot.summary;
  const stale = isSnapshotStale(snapshot, now);
  const summaryRows: Array<[string, number]> = [
    ["Total", s.total],
    ["Passed", s.passed],
    ["Failed", s.failed],
    ["Timed out", s.timedOut],
    ["Cancelled", s.cancelled],
    ["Blocked", s.blocked],
    ["Skipped", s.skipped],
    ["Unexecuted", s.unexecuted],
  ];
  const caseRows = snapshot.cases
    .map((c) => {
      const detail = c.detail
        ? `<div class="detail">
            ${
              c.detail.failedStepAction
                ? `<div>Failed step: <strong>${esc(c.detail.failedStepAction)}</strong></div>`
                : ""
            }
            ${c.detail.expected ? `<div>Expected: ${esc(c.detail.expected)}</div>` : ""}
            ${c.detail.actual ? `<div>Actual: ${esc(c.detail.actual)}</div>` : ""}
            ${
              c.detail.probableClassification
                ? `<div>Probable classification (hypothesis, not a confirmed root cause): ${esc(c.detail.probableClassification)}${
                    c.detail.confidence !== null
                      ? ` — confidence ${Math.round(c.detail.confidence * 100)}%`
                      : ""
                  }</div>`
                : ""
            }
            ${c.detail.uncertainty ? `<div>Uncertainty: ${esc(c.detail.uncertainty)}</div>` : ""}
          </div>`
        : "";
      return `<tr><td>${esc(c.title)}</td><td>${esc(c.status)}</td><td>${formatDuration(c.durationMs)}</td></tr>${detail ? `<tr><td colspan="3">${detail}</td></tr>` : ""}`;
    })
    .join("\n");

  return page(
    `${snapshot.runName} — QA report`,
    `<h1>${esc(snapshot.runName)}</h1>
<p class="meta">${esc(snapshot.projectName)} · ${esc(snapshot.source)} run · status: ${esc(
      snapshot.executionStatus ?? snapshot.status,
    )}${snapshot.durationMs !== null ? ` · duration ${formatDuration(snapshot.durationMs)}` : ""}</p>
<p class="meta">Report generated ${esc(formatDate(snapshot.generatedAt))} · Data as of ${esc(formatDate(snapshot.dataAsOf))}</p>
${stale ? `<div class="stale"><strong>This report may be stale.</strong> The underlying run data is more than 24 hours old; newer runs may exist.</div>` : ""}
<h2>Summary</h2>
<table><tbody>
${summaryRows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("\n")}
</tbody></table>
<h2>Test cases</h2>
<table>
<thead><tr><th>Case</th><th>Result</th><th>Duration</th></tr></thead>
<tbody>
${caseRows}
</tbody>
</table>
<footer>Read-only public report generated by TestPilot AI. It contains the summary the report owner approved for sharing. Raw artifacts, logs, and workspace data are not included.</footer>`,
  );
}

const NOT_FOUND_HTML = page(
  "Report not found",
  `<h1>Report not found</h1>
<p>This link is invalid, has been revoked, or has expired.</p>`,
);

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const resolution = await resolvePublicReport(token, ip, new Date());

  if (resolution.status === "rate_limited") {
    return new Response(
      page("Too many requests", "<h1>Too many requests</h1><p>Please try again later.</p>"),
      {
        status: 429,
        headers: { ...BASE_HEADERS, "Retry-After": String(resolution.retryAfterSeconds) },
      },
    );
  }
  if (resolution.status === "not_found") {
    return new Response(NOT_FOUND_HTML, { status: 404, headers: BASE_HEADERS });
  }

  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (resolution.noIndex) headers["X-Robots-Tag"] = "noindex, nofollow";
  return new Response(renderReport(resolution.snapshot, new Date()), {
    status: 200,
    headers,
  });
}
