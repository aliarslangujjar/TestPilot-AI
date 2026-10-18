# TestPilot AI — Phase Status

Living document — updated at every phase boundary. Last updated: 2026-10-18.

**Status key:** ✅ complete · 🔶 in progress · ⬜ planned · 🛑 blocked.

## Phase-completion rules

A phase is complete **only** when all of the following hold. Until then it
stays 🔶, no matter how much code is written.

1. **Explicit commission.** The phase began with an explicit instruction.
   Never start the next phase on the momentum of the previous one.
2. **Scope delivered.** Every deliverable in the phase's commission (or
   ROADMAP entry) is implemented; anything deferred is named explicitly.
3. **Checks green.** `npm run verify`
   (`typecheck → lint → format:check → test → build`) passes end to end.
4. **Migrations verified.** If the phase touched the database, every
   migration applied cleanly and its canary query returned the expected
   result. Cloud/project state is verified, never assumed.
5. **Docs current.** This file, `PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, and
   `ROADMAP.md` reflect what was actually built — planned vs implemented is
   stated honestly.
6. **Committed & pushed.** Conventional-commit message, pushed to `main`,
   remote HEAD verified equal to local HEAD.
7. **STOP.** Report done-or-blocked plus any single outstanding item, then
   stop. The next phase waits for explicit instruction.

## Tracker

| Phase                                        | Scope                                           | Status | Evidence / notes                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Project scaffold                         | Repo skeleton, tooling, docs; zero product code | ✅     | Commit `8b1dd29` (`chore: initialize Next.js + TypeScript project scaffold`), pushed 2026-10-18, remote HEAD = `8b1dd29`; `npm run verify` green (typecheck, lint, format, 3/3 tests, build) |
| 1 — Foundation (Supabase, auth, core schema) | Per ROADMAP                                     | ⬜     | Not commissioned                                                                                                                                                                             |
| 2 — Projects & test-case management          | Per ROADMAP                                     | ⬜     | Not commissioned                                                                                                                                                                             |
| 3 — AI test generation                       | Per ROADMAP                                     | ⬜     | Not commissioned                                                                                                                                                                             |
| 4 — Playwright worker & execution            | Per ROADMAP                                     | ⬜     | Not commissioned                                                                                                                                                                             |
| 5 — Results, insights & notifications        | Per ROADMAP                                     | ⬜     | Not commissioned                                                                                                                                                                             |
| 6+ — Hardening & scale                       | Unscoped                                        | ⬜     | Not commissioned                                                                                                                                                                             |

## Current focus

Phase 0 is complete. No roadmap phase is in progress. Awaiting explicit
commission for Phase 1 (or any other next step).

## Scoped tasks (outside roadmap phases)

| Task                                                | Scope                                                                                                                                                                                                                                                                                                                                                       | Status | Evidence / notes                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard page (UI only)                            | `app/dashboard` route + `components/dashboard/*`: labeled demo metrics, passed/failed/skipped breakdown, SVG pass-rate trend, recent-runs table, new-user empty state, accessible create-project dialog; responsive + accessible; component tests                                                                                                           | ✅     | All data is hardcoded sample data — the page states no real browser tests have run. No backend, no product logic. `npm run verify` green; 7 new test files (see `tests/dashboard/`)                                                                                                                                                                                  |
| Supabase data layer (clients, env, migrations, RLS) | `lib/supabase/*` (browser/server/admin clients, zod env validation, `workspace-auth.ts` server-side authorization); 5 versioned migrations (helpers, profiles, workspaces, memberships, projects) with UUIDs/timestamps/FKs/indexes, RLS + grants; `supabase/seed.sql`; RLS test suite (24 assertions) + unit tests; `docs/DATABASE.md`, `docs/SECURITY.md` | ✅     | Migrations applied cleanly to local PostgreSQL 16; **24/24 RLS assertions passed** (unauthenticated denied, authenticated scoped, cross-workspace blocked, last-owner protected). Service-role key never in browser code (runtime guard in `admin.ts`); RLS never disabled. Cloud Supabase project + Auth UI remain the owner's/future steps. `npm run verify` green |
| Auth UI (login, session, profile trigger)           | `proxy.ts` (Next 16 convention: session refresh + `/dashboard` protection, `/login` redirect), `app/login` sign-in/sign-up form, sign-out + user email in dashboard header, `20261018140500_profile_trigger.sql` (auto-creates profiles on signup; verified on local PG)                                                                                    | ✅     | 6 login-form tests (mocked client) green; trigger verified: canary = 1, insert into `auth.users` creates profile row. `npm run verify` green                                                                                                                                                                                                                         |
