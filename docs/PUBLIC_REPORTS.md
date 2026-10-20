# Public QA Reports

Opt-in, read-only public reports for a test run, at `/r/<token>`.
Created from the run detail view (manual and automated runs) via the
**Public report** panel.

## How sharing works

1. A workspace member creates a report for a run. At creation time the
   run's data is **snapshotted** into a public-safe payload — the public
   only ever sees that snapshot, never live workspace data.
2. The link token is 256 bits of randomness (base64url). **Only its
   SHA-256 hash is stored** (`public_reports.token_hash`); the raw token
   is shown exactly once, at creation. Losing it means creating a new
   link — it cannot be recovered or re-displayed.
3. Anyone with the link sees a read-only HTML report. No sign-in.

## What a report contains — and what it never contains

The snapshot builder (`lib/public-reports/snapshot.ts`) is the leakage
boundary: it constructs a fresh object from an allowlist of fields.

Contains: project name, run name, source, status, duration, generation
timestamp, data-as-of timestamp, summary counts, and per-case title /
result / duration. **Optionally** (owner opt-in, off by default):
sanitized failure evidence per failed case — failed step action,
expected vs. actual, and the AI analysis's probable classification,
confidence, and uncertainty (labelled a hypothesis).

Never contains: workspace/project/run/result/job ids, user names or
emails, run notes or result notes, console/network logs, artifact paths
or storage URLs, environment data, or credentials. Every free-text value
passes through the evidence sanitizer (password=/Bearer/api-key/JWT
shapes redacted) with length caps. Raw artifacts stay private — sharing
an artifact still requires the separate signed-URL flow.

## Revocation, expiry, and indistinguishability

- **Revoke** sets `revoked_at`; the very next public read fails.
- Optional expiry (7 or 30 days) sets `expires_at`.
- Unknown, revoked, and expired tokens return the **same generic 404** —
  the endpoint cannot be used to probe which links exist.

## Defenses on the public route

- **Rate limit:** 30 reads/minute per (token, IP), sliding window
  (`lib/public-reports/rate-limit.ts`). In-memory = per-instance; on
  multi-instance deployments treat it as a floor (a shared store would
  be needed for exact global limits). Exceeding it returns 429 with
  `Retry-After`.
- **Malformed tokens** are rejected before any database lookup.
- **Headers:** `Cache-Control: private, no-store`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  and a strict CSP (`default-src 'none'; sandbox`). When the owner kept
  the default **noindex** option, `X-Robots-Tag: noindex, nofollow` is
  sent; owners may opt out at creation.
- **XSS:** all snapshot text is HTML-escaped at render; the snapshot
  itself is zod-validated on every read.
- **Stale indicator:** the page displays the generation timestamp and
  the data-as-of time, and shows a "may be stale" banner when the run
  data is over 24 hours old.
- Public reads use the service role server-side and select only the
  report row; there is deliberately **no anon RLS policy**.

## Storage

Migration `20261019180000_public_reports.sql` creates
`public.public_reports` with member-only RLS for management;
view counts (`view_count`, `last_viewed_at`) are updated best-effort on
each public read and never block it.
