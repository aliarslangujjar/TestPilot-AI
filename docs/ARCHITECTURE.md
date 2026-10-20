# TestPilot AI — Architecture

Living document. Last updated: 2026-10-18.

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

### 2.1 Web app (`app/`, `components/`, `lib/`) — ✅ scaffolded

Owns: UI, API routes, auth session handling, AI orchestration (provider TBD).

Must never:

- Execute browsers or run Playwright. Browser execution belongs to the worker.
- Expose the Supabase `service_role` key to the client. It lives server-side
  only (API routes), never in client bundles.
- Bypass Row Level Security by reaching Postgres directly from client code.

### 2.2 Data plane (Supabase: Postgres + Auth) — ⬜ planned

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

### 2.4 Shared schemas (`packages/schemas/`) — 🔶 foundational primitives only

zod v4 schemas imported by the web app and the worker via the `@schemas/*`
path alias. This is the **contract boundary**: API shapes, job payloads, and
row types are defined once, here, so the two runtimes cannot drift.

Rules:

- Every API route validates request input against a schema from here.
- Every worker job payload and result report validates against a schema.
- No `any`-typed payloads cross a boundary.
- Today this holds only primitives (`uuidSchema`, `isoDateTimeSchema`,
  `paginationSchema`, `apiErrorSchema`). Domain schemas arrive with the
  product domain — see ROADMAP Phase 1–2.

### Boundary-crossing summary

| From → To         | Contract                                  | Status |
| ----------------- | ----------------------------------------- | ------ |
| Web → Postgres    | RLS-scoped client (`anon`) / service role | ⬜     |
| Worker → Postgres | Service role, explicit authz in code      | ⬜     |
| Web → Worker      | Job queue (mechanism TBD — see §5)        | ⬜     |
| Worker → Web      | Result-reporting API + shared schemas     | ⬜     |
| Anyone → Anyone   | `@schemas/*` zod contracts                | 🔶     |

## 3. Authorization model

- **Identity:** Supabase Auth. Sessions live in the web app; the worker is a
  service principal, not a user. ⬜
- **Enforcement point:** Postgres RLS for user-scoped data. Policies are
  written per table, alongside the migration that creates the table (§4).
  Service-role code paths enforce authorization in application code because
  RLS does not apply to them. ⬜
- **Tenancy:** multi-tenant workspaces are planned (ROADMAP Phase 1+). Until
  the tenancy model lands, no shared-workspace features are built. ⬜
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY` and any AI provider keys are
  server-only. Names are declared in `.env.example`; values live in
  `.env.local` / the hosting provider's secret store and are never committed
  (`.gitignore` enforced). ✅ (convention; no keys exist yet)

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
- **Status:** ⬜ no migrations exist yet. Conventions documented in
  `supabase/migrations/README.md`.

## 5. Background browser execution (Playwright worker)

Status: ⬜ **planned — not implemented.** This section is the design target;
nothing here exists in code.

- **Topology:** the worker is a separate, long-running Node.js process (its
  own deployable and scaling unit), independent of the web app's lifecycle.
- **Job lifecycle:** `queued → claimed → running → succeeded | failed`,
  persisted in Postgres so a crashed worker never loses a job's state.
  Claiming is atomic (one worker owns a job).
- **Execution:** each run gets an isolated Playwright browser context
  (fresh storage state per run); runs are time-boxed and resource-limited.
- **Result reporting:** the worker posts structured results (validated
  against `@schemas/*`) to the web app's API or directly to Postgres via the
  service role — the exact sink is an open decision (see PROJECT_CONTEXT §6).
- **Failure handling:** browser crashes, timeouts, and infra errors are
  reported as run outcomes with logs/artifacts attached, never swallowed.
- **What the worker never does:** serve HTTP UI, hold user sessions, or write
  outside its result-reporting contract.

Expected dependencies when commissioned: `playwright`,
`@supabase/supabase-js`, `zod`. No worker code, manifest, or lockfile exists
today — adding them is ROADMAP Phase 4.

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
- **API routes:** test handlers with validated-input / rejected-input cases
  once routes exist. ⬜
- **E2E (Playwright, against the web app):** planned for critical user
  flows once they exist; lives apart from the execution worker. ⬜
- **Worker tests:** run logic unit-tested with a mocked browser; a small
  integration matrix against real Playwright on commissioning. ⬜
- **Gate:** `npm run verify`
  (`typecheck → lint → format:check → test → build`) must pass before any
  push. ✅

## 8. Configuration & environments

| Concern           | Rule                                                    | Status          |
| ----------------- | ------------------------------------------------------- | --------------- |
| Variable names    | Declared in `.env.example` (names only)                 | ✅              |
| Local values      | `.env.local`, gitignored, never committed               | ✅ (convention) |
| Required at build | Only `NEXT_PUBLIC_*` may be inlined into client bundles | ✅ (convention) |
| Deployments       | Secret store of the hosting provider (TBD)              | ⬜              |

## 9. Implemented vs planned

| Area                                                                         | Status          |
| ---------------------------------------------------------------------------- | --------------- |
| Next.js 16 App Router shell, Tailwind v4 + shadcn theme, `cn()`, `ui/button` | ✅              |
| ESLint (Next plugin) + Prettier + strict TS + aliases                        | ✅              |
| Vitest + smoke tests                                                         | ✅              |
| Shared-schema primitives                                                     | 🔶              |
| Migration / RLS / authz conventions                                          | ✅ (documented) |
| Supabase project, schema, Auth, RLS policies                                 | ⬜              |
| API routes, AI test generation                                               | ⬜              |
| Queue, Playwright worker, result reporting                                   | ⬜              |
| Tenancy, deployment targets                                                  | ⬜              |

## 10. Document map

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — what this is, status, setup, open decisions
- [ROADMAP.md](ROADMAP.md) — phased build plan with exit criteria
- [PHASE_STATUS.md](PHASE_STATUS.md) — living tracker of phase completion
- [decisions/ADR-001-initial-architecture.md](decisions/ADR-001-initial-architecture.md) — why this architecture
