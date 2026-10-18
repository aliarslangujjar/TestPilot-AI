# ADR-001: Initial architecture for TestPilot AI

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** repository owner (Ali Arslan) + lead engineer (Muse)
- **Scope:** repository structure, web stack, data layer, test-execution
  topology, and shared contracts for the initial scaffold (Phase 0).

## Context

TestPilot AI is a new open-source AI-powered QA SaaS: users describe what to
test, the platform generates browser tests, executes them, and reports
results. The repository was empty (MIT license only). We needed an initial
architecture that:

1. Lets a small team build UI, data model, AI generation, and browser
   execution in parallel without stepping on each other.
2. Keeps browser execution — heavy, flaky, resource-intensive — from
   destabilizing the web app.
3. Prevents API/contract drift between the web app and the execution layer.
4. Starts from stable, boring, well-understood technology.

## Decision

1. **Next.js 16 (App Router) + React 19 + TypeScript (strict)** as the single
   web stack, at the repository root. Server Components by default.
2. **Supabase (Postgres + Auth)** as the data plane and identity provider.
   Postgres is the system of record; schema evolves through versioned,
   up-only SQL migrations; RLS is the enforcement point for user data.
3. **A standalone Playwright worker** (separate Node.js deployable) for all
   browser execution. It consumes jobs from a queue and reports structured
   results; it never serves UI and never shares state with the web app.
4. **Shared zod v4 schemas** in `packages/schemas`, imported via the
   `@schemas/*` path alias, as the contract boundary between web app and
   worker (API shapes, job payloads, row types).
5. **Tailwind CSS v4 + shadcn/ui** (new-york theme) for styling, with `cn()`
   and theme tokens in `app/globals.css`.
6. **Single `package.json` + single `package-lock.json`** at the root until
   a second deployable (the worker) is extracted — no duplicate manifests or
   lockfiles.
7. **Quality gate:** `npm run verify`
   (`typecheck → lint → format:check → test → build`) must pass before any
   push. ESLint uses the Next.js flat-config plugin; formatting is Prettier.
8. **Phased, explicitly commissioned delivery** with phase-completion rules
   (see `docs/PHASE_STATUS.md`): no phase starts without explicit
   instruction.

## Alternatives considered

- **Monorepo workspaces (npm/pnpm/turbo) now:** rejected as premature. One
  manifest is simpler while there is a single deployable; workspaces arrive
  when the worker is extracted (the `@schemas/*` alias is the seam).
- **Prisma/Drizzle instead of raw SQL migrations:** rejected for now. SQL
  migrations keep RLS policies, grants, and functions in one reviewable
  artifact per change, which matters more than ORM ergonomics for this
  project.
- **In-process browser execution (worker inside Next.js):** rejected. It
  couples web-app availability to browser workloads and complicates scaling
  and failure isolation.
- **Tailwind v3 + `tailwind.config.js`:** rejected. v4's CSS-first
  configuration is the current stable path and matches the shadcn v4 setup.
- **TypeScript 7 (native port):** rejected for now. Pinned TS 5.9.3 for
  tooling compatibility (ESLint, editor plugins); revisit when the
  ecosystem settles.

## Consequences

- **Positive:** clear ownership per boundary; the worker can be built,
  deployed, and scaled independently; contracts are validated at runtime by
  zod on both sides; the scaffold is installable and verifiable today.
- **Negative / accepted risks:** the queue mechanism and result-reporting
  sink are still undecided (open decisions in `PROJECT_CONTEXT.md`); the
  `@schemas/*` alias must be replaced by a real workspace package when the
  worker extracts; Supabase ties us to Postgres semantics.
- **Not decided here:** AI provider, queue technology, tenancy model,
  deployment targets — all tracked as open decisions.

## References

- `docs/ARCHITECTURE.md` — boundaries, authz, migrations, conventions
- `docs/ROADMAP.md` — phased plan
- `docs/PHASE_STATUS.md` — completion rules and tracker
- `docs/PROJECT_CONTEXT.md` — status and open decisions
