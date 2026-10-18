# TestPilot AI — Project Context

Living document: update it whenever the architecture or implementation status
changes. Last updated: 2026-10-18.

## 1. What this is

TestPilot AI is an open-source, AI-powered QA SaaS: users describe what they
want tested, the platform generates and executes browser tests, and reports
results. This repository currently contains **only the project scaffold** —
structure, tooling, and docs. No product features exist yet.

## 2. Architecture direction

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────┐
│  Web app    │─────▶│  Supabase        │◀─────│  Playwright  │
│  (Next.js)  │      │  (Postgres+Auth) │      │  worker      │
└─────────────┘      └──────────────────┘      └──────────────┘
        │                      ▲                       │
        └────── shared zod schemas (packages/schemas) ─┘
```

- **Web app** (`app/`, `components/`, `lib/`): Next.js 16 App Router,
  TypeScript strict, Tailwind v4 + shadcn/ui. Owns UI, API routes, auth
  session handling, and AI orchestration (provider TBD).
- **Supabase** (`supabase/migrations/`): PostgreSQL is the system of record
  (users, projects, test cases, runs, results). Migrations are the only way
  schema changes; each table-creating migration carries its own grants, RLS,
  and policies.
- **Playwright worker** (`workers/playwright/`, planned): a standalone
  Node.js service that pulls test-run jobs from a queue, executes them with
  Playwright, and reports results. Deliberately separate from the web app so
  browser execution scales and fails independently of the UI.
- **Shared schemas** (`packages/schemas/`): zod v4 schemas imported by both
  the web app and the worker via the `@schemas/*` path alias, so API shapes
  and row types can't drift. No separate manifest/lockfile today; promote to
  a workspace package if the worker is extracted.

## 3. Current implementation status

| Area                | Status                                                      |
| ------------------- | ----------------------------------------------------------- |
| Next.js app shell   | ✅ Scaffolded (`app/layout.tsx`, `app/page.tsx`)            |
| Tailwind v4 theme   | ✅ shadcn new-york tokens in `app/globals.css`              |
| shadcn/ui setup     | ✅ `components.json`, `lib/utils.ts` (`cn()`), `ui/button`  |
| ESLint / Prettier   | ✅ Flat config with `@next/eslint-plugin-next`; Prettier 3  |
| TypeScript          | ✅ Strict, `tsc --noEmit`, path aliases `@/*`, `@schemas/*` |
| Tests               | ✅ Vitest scaffold with smoke tests                         |
| Shared schemas      | ✅ Foundational primitives only (no domain schemas yet)     |
| Supabase migrations | ⬜ Folder + conventions documented; no migrations           |
| Playwright worker   | ⬜ README-only placeholder; not implemented                 |
| Auth / database     | ⬜ Not started                                              |
| AI generation       | ⬜ Not started (provider undecided)                         |
| Product features    | ⬜ None — explicitly out of scope for the scaffold          |

## 4. Setup commands

```bash
npm install          # single root install; produces package-lock.json
cp .env.example .env.local
npm run dev          # http://localhost:3000
npm run verify       # typecheck → lint → format:check → test → build
```

## 5. Conventions

- TypeScript everywhere; strict mode; avoid `any`.
- Conventional Commits; trunk-based (`main`).
- Never commit secrets (`.env*` ignored except `.env.example`, which holds
  names only).
- Migrations: `<YYYYMMDDHHMMSS>_<description>.sql`, self-contained
  (grants + RLS + policies).
- New shadcn components: `npx shadcn@latest add <component>` (keeps
  `components.json` aliases working).
- One manifest / one lockfile at the repo root until a deployable is
  extracted.

## 6. Open decisions

1. AI provider(s) for test generation (and cost/usage metering approach).
2. Job queue mechanism between the web app and the Playwright worker.
3. Supabase project setup + initial schema design (follows the product
   domain definition).
4. Auth model (Supabase Auth roles for multi-tenant workspaces).
5. Deployment targets (web app; worker hosting).

## 7. Documentation map

- `docs/ARCHITECTURE.md` — application boundaries, authorization, background
  browser execution, versioned migrations, coding/testing conventions;
  planned vs implemented.
- `docs/ROADMAP.md` — phased build plan with deliverables and exit criteria.
- `docs/PHASE_STATUS.md` — living phase tracker + phase-completion rules.
- `docs/decisions/ADR-001-initial-architecture.md` — why this architecture.
