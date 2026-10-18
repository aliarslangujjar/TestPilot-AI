# supabase/migrations

Supabase (PostgreSQL) migrations for TestPilot AI live here.

- Naming: `<YYYYMMDDHHMMSS>_<short_description>.sql`
  (e.g. `20261018000000_init.sql`), matching the Supabase CLI convention.
- Every migration that creates a table must be self-contained: grants, RLS
  enablement, and policies travel with the migration that creates the table.
- Never commit secrets or seed data containing real credentials in migrations.

No migrations exist yet — the database schema is designed when the product
domain is defined. To apply migrations locally or to a linked project, use
the Supabase CLI:

```bash
supabase db push
```
