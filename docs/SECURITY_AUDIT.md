# Security audit — 2026-10-20

A scoped, code-level security audit of TestPilot AI, covering auth,
sessions, workspace isolation, RLS, server authorization, XSS, CSRF,
injection, SSRF/DNS-rebinding, redirect/egress controls, metadata
endpoints, secrets handling, artifact access, public-report
redaction, signed URLs, quotas, dependencies, worker isolation, and
untrusted community templates.

**Method and limits.** Three independent review passes over the
source, plus targeted manual verification of every candidate finding
against the actual code and SQL before anything was called a defect.
That verification mattered: roughly half of the initially reported
candidates were false positives (see "Investigated and cleared").
This audit is **not** a penetration test, did not run against a live
deployed stack (none exists yet — see `docs/DEPLOYMENT.md`), and does
not by itself establish that the system is secure. Items marked
"pattern-verified" follow the project's migration convention: SQL was
reviewed statically and awaits the canary on a real database.

## Confirmed findings and fixes

### HIGH — Usage-metering RPCs were executable by any caller

`reserve_usage`, `release_usage`, `meter_usage`, and
`set_storage_usage` were designed as service-role-only, and the
migration granted EXECUTE to `service_role` — but PostgreSQL grants
EXECUTE on new functions to PUBLIC by default, and nothing revoked it.
Any unauthenticated or authenticated caller could invoke them through
PostgREST RPC with arbitrary workspace ids and amounts — zeroing or
inflating usage counters and defeating the free-plan quotas
(quota evasion for themselves, griefing for others).

**Fix** (`supabase/migrations/20261020140000_security_hardening.sql`):
`REVOKE EXECUTE … FROM public, anon, authenticated` on all four
functions; service_role grant re-affirmed. Regression test:
`tests/security/hardening-migration.test.ts`. Live canary after
applying: the count of `information_schema.routine_privileges` rows
for these functions with grantee in (`PUBLIC`, `anon`,
`authenticated`) must be **0**.

### MEDIUM — Public-report rows could be rewritten past revocation

The member UPDATE policy on `public_reports` was row-scoped
(membership) but column-blind. Through direct PostgREST calls a
workspace member could clear `revoked_at` on a revoked report
(resurrecting a share link), replace `token_hash` with the hash of a
token they chose, or rewrite the snapshot wholesale — bypassing the
app layer, which offers none of those operations.

**Fix** (same migration): the UPDATE policy now excludes revoked rows
(`revoked_at is null` in USING), and column privileges restrict
member UPDATE to `revoked_at` only — the single column the app writes
as a member (view counts use the service role). Revocation still
works: the row is un-revoked when the revoke update runs.

### MEDIUM — Worker SSRF guard missed special-registry IPv4 ranges

The denylist covered loopback/private/link-local/metadata ranges but
not: 100.64.0.0/10 (CGNAT, cloud-internal on several providers),
198.18.0.0/15 (benchmarking), 192.0.0.0/24, the TEST-NET
documentation ranges, 240.0.0.0/4 (reserved, incl. broadcast).

**Fix** (`workers/playwright/src/ssrf.ts`): all ranges added.
Regression tests in `tests/worker/ssrf.test.ts` including the /10
boundary (100.63.x stays allowed).

### LOW — Error-report beacon had no rate limit

`POST /api/error-report` is unauthenticated by design (errors occur
on public pages). Payloads were capped and structured-logged via
`JSON.stringify` (so log forging was not possible), but volume abuse
(log flooding/cost) was unbounded.

**Fix** (`app/api/error-report/route.ts`): best-effort per-IP rate
limit via the project's shared limiter (30/min, 429 +
`Retry-After`). Per-instance, like the existing public-report
limiter; exact global limiting needs a shared store or edge rules.
Regression test in `tests/observability/health-and-reporting.test.ts`.

### LOW — Health probe followed redirects

`GET /api/health` fetched the operator-configured Supabase URL with
default redirect behavior; a redirect would silently retarget the
probe and its `apikey` header.

**Fix** (`app/api/health/route.ts`): `redirect: "manual"`; a 3xx now
reads as `unreachable`. Regression test asserts the fetch options.

### PROCESS — Dependencies were not being audited anywhere

`npm audit` is unreachable from the development sandbox (egress
policy) and CI didn't run it.

**Fix**: an advisory `Dependency audit` job in GitHub Actions CI
(`npm audit --audit-level=high`, `continue-on-error` so it reports
without gating). Findings still require human triage into upgrades.

## Investigated and cleared (false positives, kept for the record)

- _"Failure-analysis SECURITY DEFINER functions lack search_path"_ —
  the named functions do not exist; every SECURITY DEFINER function
  in the migrations (13) pins `set search_path`, verified by scan.
- _"Usage quota denial can be bypassed via exception messages"_ —
  `reserve_usage` RETURNS false on denial (never raises); the app
  honors the boolean. The only fail-open path is genuine
  infrastructure errors — a deliberate, documented trade-off (below).
- _"Profiles UPDATE policy lacks WITH CHECK"_ — it has an explicit
  `with check (auth.uid() = id)`.
- _"Proxy fails open on malformed Supabase URL"_ — the env schema
  validates `.url()` inside the try/catch the proxy guards with.
- _"An exported action mints signed URLs with only a login check"_ —
  no such action exists. The real artifact action
  (`getArtifactSignedUrl`) requires workspace membership, validates
  the path shape and workspace prefix, verifies the artifact is
  referenced by a run in that workspace, and signs for 300 seconds.
- _"Playwright traces/videos are captured"_ — no trace/video capture
  exists anywhere in the codebase (screenshots only, by design).
- _"Invite tokens travel in URLs"_ — there is no invite feature in
  this codebase. Password-reset links are the standard Supabase
  email flow (see residual risks).

## Verified sound (sampled, with evidence)

- **Auth/session**: proxy validation via `auth.getUser()`; refresh
  failures degrade to signed-out; Next 16 `proxy.ts` never exports
  session data to the client.
- **Server authorization**: every server action validates input with
  zod before any DB access, then calls `requireWorkspaceClient`
  (membership re-check per call, indistinguishable denials); all
  queries are workspace-scoped. The admin client factory throws when
  constructed in a browser context; admin uses are preceded by
  membership checks.
- **XSS**: no `dangerouslySetInnerHTML` outside the static theme
  bootstrap constant; no eval/Function/document.write; user content
  renders through React escaping, including public reports and
  community templates.
- **CSRF**: state changes ride on Next server actions (framework
  origin checks) plus POST-only route handlers; the one other
  mutating endpoint (GitHub webhook) is HMAC-verified with delivery
  dedupe.
- **Injection**: no PostgREST `.or()`/string-built filters anywhere;
  all queries parameterized by supabase-js; search uses escaped,
  scoped queries.
- **Secrets**: no real secrets in the tracked tree or in git history
  (pickaxe scan for provider key shapes); only `.env.example` files
  are tracked; service-role key is server-only and absent from every
  `NEXT_PUBLIC_*` variable; integration secrets are AES-256-GCM
  encrypted at rest and write-only.
- **Worker isolation**: covered in depth by the worker work —
  per-job contexts, no evaluate/init scripts/secret headers, claim
  atomicity, cancellation, lease reaping; a boundary test proves the
  web app never imports worker/Playwright code.
- **Public reports**: 256-bit tokens, SHA-256 hash-only storage,
  resolver returns only the validated snapshot (no ids, emails,
  internal URLs, or artifact paths), revocation and expiry checked
  on every read, per-token+IP rate limiting, no-index headers.
- **Templates**: strict schema re-validation on import, executable
  content scanning, URL restrictions; imported plans still pass the
  worker's plan validation + SSRF guard at execution time.

## Residual risks and accepted trade-offs

1. **No global CSP** (documented in `next.config.ts`): the inline
   theme bootstrap would break under a strict policy. Compensations:
   React escaping everywhere, no raw-HTML sinks, `X-Frame-Options:
DENY`, nosniff, and a strict referrer policy globally, plus a
   sandboxed CSP on the public-report route specifically. Revisit
   with nonces if the app grows richer HTML surfaces.
2. **SSRF TOCTOU**: the worker guard resolves DNS and Chromium
   resolves again at connect time; a hostile DNS server could in
   theory rebind between the two. Standard residual without an
   egress proxy; mitigated by per-request + per-redirect-hop checks,
   short DNS cache TTL, and fail-closed behavior.
3. **Rate limiting is per-instance** for the public-report and
   error-report limiters (in-memory). Production should add edge
   rate limiting (e.g. Vercel WAF rules) for auth-adjacent routes;
   Supabase's own auth rate limits cover sign-in/reset endpoints.
4. **Usage metering fails open on infrastructure errors** (reserve
   returns allowed if the RPC is unreachable) — deliberate: a
   metering outage must not take down AI features. Denials (RPC
   reachable, returns false) always enforce.
5. **GitHub dispatch cap is per-instance in-memory** (20/hr/workspace
   per app instance) — documented in the integration design.
6. **Password-reset links carry tokens** (Supabase email flow):
   short platform expiry; sessions rotate on use; the app never logs
   URLs with fragments.
7. **Migrations since 2026-10-18 are pattern-verified, not yet
   applied to a live database** (no local PG in the sandbox; the
   cloud project doesn't exist yet). The hardening migration above
   carries the same status until its canary returns 0.
8. **No live penetration test has been run** — there is no deployed
   stack to test. The six-point deployment verification in
   `docs/DEPLOYMENT.md` plus a staging pentest are the recommended
   next steps before calling anything production-ready.
