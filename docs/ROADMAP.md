# TestPilot AI — Roadmap

Living document. Last updated: 2026-10-18.

Phases are sequential and explicitly commissioned: **no phase begins without
explicit instruction**, even when the previous phase is complete. Each phase
closes per the phase-completion rules in [PHASE_STATUS.md](PHASE_STATUS.md).

**Status key:** ✅ complete · 🔶 in progress · ⬜ planned.

## Phase 0 — Project scaffold ✅ complete

- **Goal:** installable, verifiable repository skeleton with zero product code.
- **Delivered:** Next.js 16 + TS strict app shell, Tailwind v4 + shadcn/ui
  setup, ESLint + Prettier + Vitest, shared-schema primitives, worker and
  migration placeholders, `.env.example`, README, docs.
- **Evidence:** commit `8b1dd29` on `main` (remote HEAD verified 2026-10-18);
  `npm run verify` green.

## Phase 1 — Foundation: Supabase, auth, core schema ⬜ planned

- **Goal:** a real database and identity, with the conventions from
  ARCHITECTURE §4–§5 enforced from the first migration.
- **Deliverables:**
  - Supabase project created and linked; `.env.example` values documented
    (values stay local/secret-store only).
  - Initial migration(s): users/profile, projects, tenancy model
    (workspace membership — exact shape TBD in design).
  - RLS policies + grants per table, in the creating migration.
  - Supabase Auth wired into the web app (sign-in/sign-out, session handling,
    protected routes).
  - Canary queries documented for every migration.
- **Exit criteria:** migrations apply cleanly to a fresh project; canaries
  pass; `npm run verify` green; auth round-trip works locally.

## Phase 2 — Projects & test-case management ⬜ planned

- **Goal:** users can organize testing work (CRUD, no AI yet).
- **Deliverables:**
  - Project and test-case schema (migrations + RLS).
  - UI: project list/detail, test-case list/detail (shadcn primitives, honest
    empty states).
  - API routes with `@schemas/*` validation and `apiErrorSchema` errors.
  - Domain schemas promoted into `packages/schemas`.
- **Exit criteria:** full CRUD through UI + API with RLS enforced;
  `npm run verify` green.

## Phase 3 — AI test generation ⬜ planned

- **Goal:** generate draft test cases from natural-language descriptions.
- **Deliverables:**
  - AI provider decision (see PROJECT_CONTEXT §6) + provider abstraction.
  - Generation API route: prompt in, validated draft test-case out
    (schema-constrained output).
  - UI: describe → review/edit → save flow; drafts clearly labeled as
    AI-generated until a human approves.
  - Cost/usage metering approach defined.
- **Exit criteria:** generated drafts validate against domain schemas;
  human approval required before a draft becomes runnable; metering visible.

## Phase 4 — Playwright worker & execution ⬜ planned

- **Goal:** execute test cases in real browsers, asynchronously.
- **Deliverables:**
  - Queue mechanism decision (see PROJECT_CONTEXT §6) + job schema in
    `@schemas/*`.
  - Worker implementation: atomic claim → isolated Playwright context →
    structured result report → terminal state persisted.
  - Run history schema (migrations + RLS).
  - UI: run detail with steps, logs, artifacts (screenshots/traces).
- **Exit criteria:** queued runs execute exactly once; crashes/timeouts
  surface as run outcomes; results validate against shared schemas;
  `npm run verify` green.

## Phase 5 — Results, insights & notifications ⬜ planned

- **Goal:** make results actionable.
- **Deliverables:** run comparisons, failure grouping/summaries, notification
  hooks (TBD), export of results.
- **Exit criteria:** TBD at commissioning.

## Phase 6+ — Hardening & scale ⬜ planned (unscoped)

Candidates: multi-tenant workspaces at scale, billing/usage plans, worker
autoscaling, self-hosting story, public API. Nothing here is designed or
committed.

## Explicitly out of scope (all phases)

- Clinical, medical, or safety-critical testing claims.
- Anything that weakens the authorization model (§3 of ARCHITECTURE) or the
  migration rules (§4) for expediency.
- Product features inside docs/scaffold commits.
