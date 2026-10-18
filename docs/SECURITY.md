# TestPilot AI — Security

Living document. Last updated: 2026-10-18.

Scope: what this document covers is **implemented and verified** unless
marked ⬜ planned. This is not a penetration test and makes no compliance
claims.

## 1. Authentication

- **Provider:** Supabase Auth (⬜ cloud project not yet created — owner's
  step). Sessions are cookie-based via `@supabase/ssr`.
- **Clients** (`lib/supabase/`):
  - `client.ts` — browser, anon key, RLS-enforced.
  - `server.ts` — server components/route handlers, anon key + user
    cookies, RLS-enforced.
  - `admin.ts` — **server only**, service-role key. Throws if
    `SUPABASE_SERVICE_ROLE_KEY` is missing, and throws if ever called in a
    browser (`typeof window` guard).
  - `env.ts` — zod-validated public env (`NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`); fails fast with a clear message
    instead of an opaque client error. The service-role key is deliberately
    absent from this module so browser bundles can never include it.

## 2. Authorization

Defense in depth, two layers:

1. **Row Level Security (primary).** Every table has RLS enabled with
   policies that scope rows to workspace membership (see
   `docs/DATABASE.md`). Cross-workspace reads return zero rows;
   cross-workspace writes are rejected. Verified by 24/24 RLS assertions
   (`supabase/tests/10_core_schema_rls.sql`).
2. **Server-side checks (for service-role paths).**
   `lib/supabase/workspace-auth.ts` provides `assertWorkspaceMembership()`
   / `assertWorkspaceAdmin()`: any server code using the admin client must
   call these before touching workspace data, because the service role
   bypasses RLS. Malformed ids and non-members are indistinguishable
   (`WorkspaceAccessDeniedError`), and query errors never leak internals.

Additional hardening in the schema:

- Ownership bootstrap is only possible on memberless workspaces.
- The last owner can neither be demoted nor removed (policy-level).
- `SECURITY DEFINER` helpers use fixed `search_path = public`.

## 3. Secrets

- Declared by name in `.env.example`; real values live in `.env.local`
  (gitignored) or the host's secret store — never committed, never in
  migrations, never in client bundles.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. The browser bundle contains
  only `NEXT_PUBLIC_*` values (anon key + URL), which are safe by design
  because RLS governs everything they can touch.

## 4. What's not done (honest list)

- ⬜ Supabase cloud project, Auth UI, session refresh middleware.
- ⬜ Audit logging for sensitive operations.
- ⬜ Rate limiting / abuse controls on workspace creation.
- ⬜ MFA / SSO policies.
- ⬜ Any security audit or penetration test.

## 5. Rules for future work

- Never disable RLS to "fix" a permission error — fix the policy or grant.
- Never `GRANT ALL` on an RLS-less table.
- Never import `lib/supabase/admin.ts` from client code (the runtime guard
  is a backstop, not the plan).
- Every new table ships with RLS + policies + grants in its creating
  migration, plus a canary query.
- Every new service-role code path calls `assertWorkspaceMembership()`
  (or stricter) first; add a unit test for it.
