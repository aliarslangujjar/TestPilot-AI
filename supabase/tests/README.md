# supabase/tests

Database-level verification for the core schema. These scripts exercise the
actual RLS policies (not mocks), so they catch policy mistakes before they
reach any shared environment.

## Files

| File                     | Purpose                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00_auth_shim.sql`       | Local-only stand-in for Supabase Auth: `anon` / `authenticated` / `service_role` roles, `auth.users(id, email)`, and `auth.uid()` reading `request.jwt.claims → sub` exactly like Supabase. Idempotent. **Never apply to a real Supabase project** (it already provides all of this).                                                                                          |
| `10_core_schema_rls.sql` | 24 assertions: unauthenticated access denied (T01–T04), authenticated users see only their own data (T05–T08), cross-workspace writes blocked (T10–T13), last-owner protection (T14–T15), member add/remove lifecycle (T16–T19), ownership bootstrap (T21–T22), and the service-role bypass (T24, documented). All test data rolls back at the end — the script is repeatable. |

## Running (this environment: local PostgreSQL 16, no Docker)

```bash
# one-time: create the database and install the auth shim
psql -c 'create database testpilot_test'
psql -d testpilot_test -v ON_ERROR_STOP=1 -f supabase/tests/00_auth_shim.sql

# apply migrations in order
for f in supabase/migrations/*.sql; do
  psql -d testpilot_test -v ON_ERROR_STOP=1 -f "$f"
done

# run the RLS suite — every check prints NOTICE "Tn PASS"; any failure
# raises EXCEPTION and aborts (ON_ERROR_STOP=1)
psql -d testpilot_test -v ON_ERROR_STOP=1 -f supabase/tests/10_core_schema_rls.sql
```

Expected: 24 `NOTICE: Tn PASS` lines, no errors.

## Running (standard path, when Docker is available)

```bash
supabase init      # once per repo
supabase start     # local Supabase (Postgres + Auth + Studio)
supabase db reset  # applies migrations + supabase/seed.sql
# then point psql at the local DB (see `supabase status`) and run
# 10_core_schema_rls.sql directly — no auth shim needed there.
```

## Results

2026-10-18, local PostgreSQL 16: all 5 migrations applied cleanly;
**24/24 RLS assertions passed** (unauthenticated denied, authenticated
scoped, cross-workspace blocked, last-owner protected, bootstrap correct,
service-role bypass confirmed).
