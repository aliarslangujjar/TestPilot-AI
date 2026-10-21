# TestPilot AI — Architecture

Living document. Last updated: 2026-10-20 (public-beta refresh: status markers
reconciled with the shipped feature set; the design content is unchanged).

This document defines the system's application boundaries, the authorization
model, how background browser execution will work, how the database evolves,
and the coding/testing conventions every change must follow. For _why_ these
choices were made, see [ADR-001](decisions/ADR-001-initial-architecture.md).
For _what gets built when_, see [ROADMAP.md](ROADMAP.md) and
[PHASE_STATUS.md](PHASE_STATUS.md).

**Status key used throughout:** ✅ implemented · 🔶 partially implemented ·
⬜ planned (not started).

## 1. System overview

```
┌─────────────────────┐      ┌──────────────────────┐      ┌──────────────────┐
│ Web app             │      │ Supabase             │      │ Playwright       │
│ (Next.js 16,        │─────▶│ (Postgres = system   │◀─────│ worker           │
│  App Router)        │      │  of record; Auth)    │      │ (Node.js service)│
└─────────────────────┘      └──────────────────────┘      └──────────────────┘
        │                              ▲                              │
        └──────── shared zod schemas (packages/schemas) ───────────────┘
```

TestPilot AI is an AI-powered QA SaaS: users describe what to test, the
platform generates browser tests, executes them, and reports results.

## 2. Application boundaries

Four boundaries. Each owns its responsibilities and its deployable; nothing
crosses a boundary except through the contracts listed.

### 2.1 Web app (`app/`, `components/`, `lib/`) — ✅ implemented

Owns: UI, API routes, auth session handling, AI orchestration
(provider-independent service over the Vercel AI SDK — OpenAI or Anthropic,
plus a no-key demo mode).

Must never:

- Execute browsers or run Playwright. Browser execution belongs to the worker.
- Expose the Supabase `service_role` key to the client. It lives server-side
  only (API routes), never in client bundles.
- Bypass Row Level Security by reaching Postgres directly from client code.

### 2.2 Data plane (Supabase: Postgres + Auth) — ✅ implemented

(Code and migrations are complete; creating the cloud Supabase project is
an owner deployment step — see the status section of DEPLOYMENT.md.)

Postgres is the system of record (users, projects, test cases, runs,
results). Supabase Auth is the identity provider.

Access rules:

- Browser/client code uses the `anon` key **only**; every table it touches
  is protected by RLS policies.
- Server code (API routes, worker) may use the `service_role` key, which
  bypasses RLS — so service-role code paths must enforce authorization
  explicitly before touching data.
- No direct Postgres connections from the browser, ever.

### 2.3 Playwright worker (`workers/playwright/`) — ✅ implemented

A standalone Node.js service and separate deployable. It pulls test-run jobs
from a queue, executes them with Playwright in isolated browser contexts, and
reports results back.

Must never: serve UI, own the system of record (it writes results through the
same contracts as everyone else), or share memory/state with the web app.

See §5 for the execution model.

### 2.4 Shared schemas (`packages/schemas/`) — ✅ implemented

zod v4 schemas imported by the web app and the worker via the `@schemas/*`
path alias. This is the **contract boundary**: API shapes, job payloads, and
row types are defined once, here, so the two runtimes cannot drift.

Rules:

- Every API route validates request input against a schema from here.
- Every worker job payload and result report validates against a schema.
- No `any`-typed payloads cross a boundary.
- Domain schemas now cover the full product: test management, test plans,
  the browser-test specification v1, runs and results, public reports,
  community templates, usage, analytics, and GitHub integrations.

### Boundary-crossing summary

| From → To         | Contract                                  | Status |
| ----------------- | ----------------------------------------- | ------ |
| Web → Postgres    | RLS-scoped client (`anon`) / service role | ✅     |
| Worker → Postgres | Service role, explicit authz in code      | ✅     |
| Web → Worker      | `browser_jobs` table queue, worker polls  | ✅     |
| Worker → Web      | Results via worker store + shared schemas | ✅     |
| Anyone → Anyone   | `@schemas/*` zod contracts                | ✅     |

## 3. Authorization model

- **Identity:** Supabase Auth. Sessions live in the web app; the worker is a
  service principal, not a user. ✅
- **Enforcement point:** Postgres RLS for user-scoped data. Policies are
  written per table, alongside the migration that creates the table (§4).
  Service-role code paths enforce authorization in application code because
  RLS does not apply to them. ✅
- **Tenancy:** multi-tenant workspaces (owner/admin/member roles), enforced
  by RLS plus the server-side membership gate (`requireWorkspaceClient`). ✅
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY` and any AI provider keys are
  server-only. Names are declared in `.env.example`; values live in
  `.env.local` / the hosting provider's secret store and are never committed
  (`.gitignore` enforced). ✅

## 4. Versioned database migrations

Migrations live in `supabase/migrations/` and are the **only** way the
schema changes. No ad-hoc DDL against any shared database.

- **Naming:** `<YYYYMMDDHHMMSS>_<short_description>.sql`
  (e.g. `20261018000000_init.sql`).
- **Direction:** up-only. A bad migration is fixed by a new migration, never
  by editing a migration that has already been applied anywhere shared.
- **Self-contained tables:** the migration that creates a table also carries
  its grants, `ENABLE ROW LEVEL SECURITY`, and its policies. New Supabase
  tables get no implicit grants — an ungranted table fails closed at the API.
  Never "fix" a permission error with `GRANT ALL` on an RLS-less table.
- **No destructive changes** (drop column/table, destructive backfill)
  without an explicit, reviewed plan that states the rollback story.
- **Verification:** after applying, verify against `information_schema`
  (canary queries: table exists, expected columns, RLS enabled, policy
  count). Never assume cloud state — check it. The canary query travels with
  the completion report, never embedded in the migration file.
- **Status:** ✅ the full schema ships as versioned migrations in
  `supabase/migrations/` (see `supabase/migrations/README.md`). Applying
  them to any given environment is verified per-environment with the
  canary queries, never assumed.

## 5. Background browser execution (Playwright worker)

Status: ✅ **implemented** — the worker (`workers/playwright/`), the job
queue (`browser_jobs`), and the automated-run bridge
(`lib/test-runs/automated.ts`) all exist. Threat boundaries:
`docs/BROWSER_WORKER.md`. The worker is **not yet deployed and has not
been run end-to-end against a live Supabase queue** — that remains an
explicit, unverified label.

- **Topology:** a separate, long-running Node.js process (own deployable,
  own scaling unit), independent of the web app's lifecycle.
- **Job lifecycle:** `queued → running → succeeded | failed | cancelled`,
  persisted in Postgres so a crashed worker never loses a job's state.
  Claims are atomic (a conditional UPDATE — exactly one worker wins),
  leases carry heartbeats, and stale leases are reaped back to `queued`
  (or `failed` when attempts are exhausted). Enqueue is idempotent on
  `(workspace_id, idempotency_key)`.
- **Automated runs:** an automated test run snapshots its cases like a
  manual run, then enqueues one job per case (key
  `run:<runId>:case:<caseId>`), linked by `run_id` / `test_case_id`.
  Each case needs a saved v1 plan (`browser_plans`, one per case).
  The worker records `failure_kind` on final failures: `assertion`
  (deterministic — never retried), `infra`, or `timeout` (retried while
  attempts remain).
- **Run state sync:** `refreshAutomatedRun` maps job state into persisted
  run state (`queued | running | passed | failed | cancelled | timed_out`
  on `test_runs.execution_status` and each `run_results` row). The sync
  is idempotent — receiving the same worker result twice changes
  nothing. A result is marked `passed` ONLY when the job's stored
  result validates against the result schema, covers exactly the
  plan's steps, and has every step ok: **never a pass without valid
  worker evidence.** Sanitized artifact references (storage paths
  only, capped) are copied onto the result.
- **Execution:** each job gets an isolated Playwright browser context
  (no storage state, no secret headers); jobs are time-boxed and
  resource-limited; the SSRF guard blocks private/loopback/link-local/
  metadata destinations with per-request DNS + redirect revalidation.
- **Cancellation:** authorized (members only). The cancel flag is set
  via the service role after a membership check; the worker honours it
  cooperatively between steps; a still-queued job with the flag is
  settled as cancelled because its steps can never execute.
- **What the worker never does:** serve HTTP UI, hold user sessions,
  execute arbitrary JavaScript or shell commands, or write anything
  except job results and bounded artifacts.

## 6. Coding conventions

- **TypeScript everywhere, strict mode.** `tsc --noEmit` must pass.
  `noUncheckedIndexedAccess` is on — index signatures return `T | undefined`,
  handle it.
- **No `any` without justification.** Prefer `unknown` + narrowing, or a zod
  schema at the boundary.
- **Validate at every boundary** with `@schemas/*`: API route inputs,
  worker payloads, webhook bodies. Invalid input → `apiErrorSchema`
  envelope (`{ code, message, details? }`), never a stack trace to clients.
- **App Router:** Server Components by default; `"use client"` only where
  interactivity requires it. Never pass functions from a Server Component to
  a Client Component (React Flight serialization forbids it — fails at
  request time, not at build).
- **Styling:** Tailwind utilities + shadcn/ui primitives + `cn()`. Design
  tokens live in `app/globals.css` (`@theme`); no ad-hoc inline styles for
  themed values. New primitives via `npx shadcn@latest add <component>`.
- **Imports:** `@/*` for repo-root-relative, `@schemas/*` for shared
  schemas. No deep relative chains (`../../../../lib`) across top-level
  directories.
- **Commits:** Conventional Commits on trunk (`main`): `feat:`, `fix:`,
  `chore:`, `docs:`, … One manifest, one lockfile at the repo root until a
  deployable is extracted.
- **No product features in scaffold/docs commits.** Docs define contracts;
  code follows in commissioned phases.

## 7. Testing conventions

- **Unit (Vitest):** ✅ configured (`tests/`, `vitest run`). Test pure
  logic, schema validation, and utilities. The `@` / `@schemas` aliases are
  wired in `vitest.config.mts` — tests may import through them.
- **API routes:** handlers tested with validated-input / rejected-input
  cases (webhooks, health, error reporting). ✅
- **Scenario/E2E:** release-readiness scenarios (`tests/release/`) cover the
  first-run journey and REAL worker execution against a loopback demo app
  (docs/RELEASE_READINESS.md). Full browser-driven E2E of the web UI itself
  remains future work. 🔶
- **Worker tests:** runner/policy/driver unit suites plus real-Chromium
  integration against the fixture target, and a staging E2E script
  (`npm run worker:e2e`). ✅
- **Gate:** `npm run verify`
  (`typecheck → lint → format:check → test → build`) must pass before any
  push. ✅

## 8. Configuration & environments

| Concern           | Rule                                                                                  | Status           |
| ----------------- | ------------------------------------------------------------------------------------- | ---------------- |
| Variable names    | Declared in `.env.example` (names only)                                               | ✅               |
| Local values      | `.env.local`, gitignored, never committed                                             | ✅ (convention)  |
| Required at build | Only `NEXT_PUBLIC_*` may be inlined into client bundles                               | ✅ (convention)  |
| Deployments       | Vercel (web) + separate worker host; runbooks in DEPLOYMENT.md / WORKER_DEPLOYMENT.md | 🔶 (owner steps) |

## 9. Implemented vs planned

| Area                                                                   | Status           |
| ---------------------------------------------------------------------- | ---------------- |
| Web app: auth, workspaces/projects, test management & manual execution | ✅               |
| AI generation + human review, template-guided plans, failure analysis  | ✅               |
| Playwright worker: queue, execution, evidence, hardening               | ✅               |
| Automated run details, comparison, analytics dashboard                 | ✅               |
| Public QA reports, community templates, GitHub Actions integration     | ✅               |
| Usage metering, free-plan quotas, demo mode                            | ✅               |
| Supabase schema (versioned migrations), Auth, RLS policies             | ✅               |
| Multi-tenant workspaces (owner/admin/member)                           | ✅               |
| Security audit fixes, release-readiness suite, deployment runbooks     | ✅               |
| Hosted cloud deployment (Vercel project + cloud Supabase)              | ⬜ (owner steps) |
| Worker Docker image build verification on a container host             | ⬜               |
| Payments / paid plans                                                  | ⬜ (deferred)    |

## 10. Document map

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — what this is, status, setup, open decisions
- [ROADMAP.md](ROADMAP.md) — phased build plan with exit criteria
- [PHASE_STATUS.md](PHASE_STATUS.md) — living tracker of phase completion
- [decisions/ADR-001-initial-architecture.md](decisions/ADR-001-initial-architecture.md) — why this architecture
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — scoped audit findings, fixes, residual risks
- [RELEASE_READINESS.md](RELEASE_READINESS.md) — release scenario suite and its actual results
- [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) — what the beta does not do (yet)
- [BETA_RELEASE_CHECKLIST.md](BETA_RELEASE_CHECKLIST.md) — beta acceptance criteria and their evidence
- [DEPLOYMENT.md](DEPLOYMENT.md) — deployment runbook and current deployment status
