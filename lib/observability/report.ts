import { randomUUID } from "node:crypto";

/**
 * Minimal structured error reporting (see docs/DEPLOYMENT.md).
 *
 * Every report becomes ONE JSON line on stderr, which Vercel captures
 * into the project's runtime logs (searchable by the returned report
 * id). There is deliberately no third-party SDK and no network call:
 * reporting can never fail the request it is reporting on, and no data
 * leaves the deployment. To forward reports to an external service
 * later, this module is the single seam to extend.
 *
 * Data minimization: only an allowlist of context fields is recorded,
 * values are capped, and error messages are capped — no request bodies,
 * headers, cookies, or tokens are ever included.
 */

export interface ErrorReportContext {
  route?: string;
  action?: string;
  digest?: string;
  workspaceId?: string;
}

const MAX_MESSAGE = 500;
const MAX_FIELD = 200;

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Report an error and return its report id (safe to show to users). */
export function reportError(error: unknown, context: ErrorReportContext = {}): string {
  const id = randomUUID();
  const err = error instanceof Error ? error : null;
  const entry: Record<string, unknown> = {
    level: "error",
    reportId: id,
    timestamp: new Date().toISOString(),
    name: err?.name ?? "NonError",
    message: cap(err?.message ?? String(error), MAX_MESSAGE),
  };
  if (context.route) entry.route = cap(context.route, MAX_FIELD);
  if (context.action) entry.action = cap(context.action, MAX_FIELD);
  if (context.digest) entry.digest = cap(context.digest, MAX_FIELD);
  if (context.workspaceId) entry.workspaceId = cap(context.workspaceId, MAX_FIELD);
  if (err?.stack && process.env.NODE_ENV !== "production") {
    entry.stack = cap(err.stack, 2000);
  }
  // One structured line; Vercel log drains pick this up as JSON.
  console.error(JSON.stringify(entry));
  return id;
}
