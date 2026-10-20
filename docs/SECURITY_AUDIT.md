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

## Addendum — late-arriving worker-scope report (same day)

The worker/SSRF review pass delivered its full report after the
audit above was committed. It contained additional findings the
first summary had not included. Each was verified against source;
the confirmed ones were fixed in a follow-up commit. This addendum
supersedes the "Verified sound" notes where they conflict.

### Confirmed and fixed in the addendum

- **MEDIUM — `allowedHosts` was never enforced at runtime.** The
  plan schema validated goto/baseUrl hosts at parse time, but the
  driver's route handler consulted only the SSRF guard — in-page
  navigations, outbound-link clicks, and subresource requests could
  reach any public host, contradicting the schema's own "nothing
  outside this list is reachable" contract. **Fix:** the route
  handler now checks every request's host against the plan's
  `allowedHosts` before the SSRF guard runs; a hand-built plan
  bypassing parse validation is blocked in a new driver integration
  test.
- **MEDIUM — protocol-relative goto bypassed the parse-time check.**
  `hostOf("//evil.example/x")` throws without a base, so the value
  fell into the relative-path branch and passed — then resolved
  cross-host at runtime. **Fix:** the schema rejects
  protocol-relative goto targets outright.
- **MEDIUM — `baseUrl` accepted any scheme.** `file:///etc/` plans
  validated (empty hostname skipped the allowlist check), turning
  assertions into a local-file substring oracle with screenshot
  exfiltration. **Fix:** the schema requires an http(s) baseUrl with
  a real host.
- **MEDIUM — SSRF denylist gaps, remainder.** The main fix added
  most ranges; the addendum completed the set: 224.0.0.0/4
  (multicast), plus IPv6 NAT64 (`64:ff9b::/96`) and Teredo
  (`2001::/32`) prefixes.
- **LOW — WebSocket egress bypassed routing.** `context.route`
  never sees WebSocket connections. **Fix:** `routeWebSocket`
  applies the same allowlist + guard checks (blocked sockets close
  immediately); the production entry point also launches Chromium
  with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  to close the WebRTC/ICE channel (no proxy is configured, so this
  effectively disables direct UDP egress).
- **LOW — community template validator: IPv6 checks were dead
  code.** `url.hostname` keeps brackets (`"[::1]"`), so every IPv6
  comparison missed, and IPv4-mapped forms escaped entirely.
  **Fix:** brackets stripped before comparison; mapped forms
  (dotted and WHATWG hex-serialized) judged by their embedded IPv4.
  Regression tests cover `[::1]`, `[fd00::1]`, `[fe80::1]`,
  `[::ffff:127.0.0.1]`.
- **LOW — job-state writes were not claim-fenced.** A worker that
  lost its lease could overwrite the winning worker's terminal
  result. **Fix:** the Supabase store's `update` now refuses to
  modify rows already in a terminal state.
- **LOW — diagnostic URLs leaked query strings.** Driver network
  diagnostics recorded full URLs; failure-analysis forwards them to
  the AI provider, whose redaction patterns don't catch
  `?token=…`. **Fix:** URLs are reduced to origin + path at capture
  time (`stripUrlQuery`), and `sanitizeError` strips queries from
  URLs embedded in error text.
- **LOW (latent) — worker authorization skipped membership when
  `created_by` was null.** All enqueue paths set it, but the worker
  now fails closed on a missing creator (the previous "legacy rows"
  test expectation was deliberately reversed).

### Still residual after the addendum

- **SSRF TOCTOU (C-4)** stands as recorded in item 2 above — the
  report correctly notes the two DNS resolutions are fully
  independent, not merely TTL-skewed. Complete closure requires an
  egress proxy that pins connections to validated IPs; that is a
  deployment-architecture decision, documented here rather than
  papered over.
- **Reservation leak on process death** (usage): a server process
  dying mid-reservation strands it until the monthly period resets.
  Self-inflicted only; accepted.
- **Rate-limit keying**: the public-report limiter keys on
  token-hash + IP, so token rotation gets a fresh budget — harmless
  at 256-bit token entropy. The `x-forwarded-for` trust caveat
  applies to all in-app limiters; edge configuration should
  overwrite the header.

## Addendum 2 — full Scope A report (same day)

The auth/RLS review's full report likewise arrived after the first
summary had been processed. Its two headline items (F1 usage-RPC
execute exposure, F6 public-report rewriting) were the HIGH and
MEDIUM fixed by migration `20261020140000`. The remaining items were
verified against source; confirmed ones are fixed in migration
`20261020150000_security_hardening_2.sql` plus application changes.

### Confirmed and fixed

- **F2 (MEDIUM) — open redirect via backslash in the auth
  callback.** `/\evil.com` passed the `next` check (starts with
  "/", not "//"), and the WHATWG parser normalizes the backslash,
  resolving off-origin. Fix: backslashes and control characters are
  rejected in `next`, and the handler asserts the resolved
  redirect's origin matches before redirecting. Regression test
  covers raw and percent-encoded forms.
- **F9 (functional, fail-closed) — the automated-run path filtered
  `test_cases` by a `project_id` column that does not exist** (cases
  scope to projects through their suite). Against a real PostgREST
  every automated-run creation and browser-plan save errored into
  "not found" — the mocked test suite could not see it. Fix: both
  queries scope via `suites!inner(project_id)`.
- **F7 (LOW) — members could forge GitHub dispatch state** through
  the member UPDATE policy. Dispatch writes are service-role now
  (webhook + the action's failure marking); the policy and grant
  are dropped in migration 2.
- **F5 (LOW) — last-owner protection bypass by row moving.** The
  memberships UPDATE policy's WITH CHECK evaluates the new row, so
  an admin of two workspaces could move a membership row between
  them and orphan a workspace. No app code updates memberships via
  the member client; member UPDATE is removed entirely (migration
  2). Member management, when built, needs a policy that also pins
  `workspace_id`/`user_id`.
- **F8 (LOW) — direct browser-job inserts** could pre-forge
  terminal states, creators, and claims. The INSERT policy now
  requires a fresh queue row authored by the caller (migration 2),
  matching exactly what both enqueue paths insert.
- **F10 (INFO) — `workspaces.created_by` spoofable and never
  set.** A trigger forces it from the caller's JWT on insert
  (migration 2).
- **F3 (LOW) — `lib/ai/service.ts` was a `"use server"` module**,
  making `generateStructured` directly invocable by any member
  outside the feature flows that build prompts deliberately
  (membership + quota checks inside the function bounded the
  impact to quota burn). The service is now a plain server module;
  the one client-needed read (`getAIStatus`, input-free) is exposed
  through a dedicated actions module.

### Assessed and accepted (documented, not fixed)

- **F4 — workspace size counts.** The SECURITY DEFINER count
  helpers return member/owner counts for any workspace id to any
  signed-in user. They cannot simply be revoked: RLS policies
  (including the zero-member bootstrap) invoke them as the caller.
  Disclosure is counts only, gated on knowing an unguessable
  workspace UUID. Accepted as a low residual; a future fix would
  return counts only to members while special-casing the bootstrap
  count inside the policy path.
- **F11 — `/reset-password` accepts any session**, not only
  recovery sessions, and password update needs no current-password
  re-entry. Standard Supabase behavior; a hijacked session is
  already full account access, so the marginal risk is small.
  Accepted; noted for the deployment checklist.
- **F12/F13** — XFF trust (already residual item above) and
  Supabase's standard JS-accessible token storage with no cookie
  overrides found misconfigured. No action.
- The Scope A pass also re-verified as sound: the proxy's
  server-validated auth and fail-closed degradation, the
  indistinguishable membership denials, every server action's
  validate-then-scope pattern, each service-role call site, the
  zero-policy secrets/deliveries tables, SECURITY DEFINER
  search-path pinning, and the public-report token design.
