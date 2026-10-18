# supabase/migrations

Supabase (PostgreSQL) migrations for TestPilot AI live here.

## Conventions

- **Naming:** `<YYYYMMDDHHMMSS>_<short_description>.sql`
  (e.g. `20261018140000_core_helpers.sql`), matching the Supabase CLI
  convention. Files apply in lexicographic order.
- **Self-contained tables:** the migration that creates a table also carries
  its grants, `ENABLE ROW LEVEL SECURITY`, and its policies. Cross-table
  checks inside policies go through `SECURITY DEFINER` helpers (see
  `20261018140000_core_helpers.sql`) — never raw subqueries on RLS-protected
  tables, which recurse infinitely.
- **Up-only:** fix a bad migration with a new migration, never by editing
  one that has been applied anywhere shared.
- **Grants:** new tables get no implicit grants on Supabase. Every migration
  grants exactly what each role needs (`authenticated` gets the operations
  the app performs via supabase-js; `service_role` gets all). Never
  `GRANT ALL` on an RLS-less table.
- **Canary:** every migration file ends with a commented canary query.
  After applying, run the canary against `information_schema` and confirm
  the expected count — never assume cloud state.
- **No secrets** in migrations, ever.

## Current migrations

| File                              | Contents                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261018140000_core_helpers.sql` | `pgcrypto`, `handle_updated_at()`, membership/role helpers (`is_workspace_member`, `workspace_user_role`, `is_workspace_admin`, `workspace_owner_count`, `workspace_other_owner_count`, `workspace_member_count`) |
| `20261018140100_profiles.sql`     | `profiles` (1:1 with `auth.users`), owner-only RLS                                                                                                                                                                |
| `20261018140200_workspaces.sql`   | `workspaces`, member-visible, admin-managed, owner-deleted                                                                                                                                                        |
| `20261018140300_memberships.sql`  | `memberships` (owner/admin/member), bootstrap + last-owner protection                                                                                                                                             |
| `20261018140400_projects.sql`     | `projects`, workspace-member-only RLS                                                                                                                                                                             |

## Local workflow

```bash
# with Docker: full local Supabase
supabase start
supabase db reset   # migrations + supabase/seed.sql

# without Docker (this VM): plain PostgreSQL + the auth shim in
# supabase/tests/00_auth_shim.sql, then apply migration files in order
# with psql. See supabase/tests/README.md for the exact commands and the
# RLS verification suite.
```

## Cloud workflow (owner's step)

1. Create the Supabase project (dashboard or CLI).
2. `supabase link --project-ref <ref>`, then `supabase db push`.
3. Run each migration's canary query in the SQL editor; confirm expected counts.
4. Record the results (see `docs/PHASE_STATUS.md`).

Never commit `SUPABASE_SERVICE_ROLE_KEY` or any real credentials.
