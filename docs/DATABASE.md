# TestPilot AI — Database

Living document. Last updated: 2026-10-18.

PostgreSQL via Supabase is the system of record. Schema changes happen only
through versioned migrations in `supabase/migrations/` (conventions in that
directory's README).

## Schema (core, Phase 1 data layer)

```
auth.users 1───1 profiles
    │ 1
    │ *
    ├─────────* memberships *───1 workspaces 1───* projects
    │                                    │
    └──────────────── created_by ────────┘
```

### profiles

| Column                  | Type        | Notes                                      |
| ----------------------- | ----------- | ------------------------------------------ |
| id                      | uuid PK     | FK → `auth.users(id)` ON DELETE CASCADE    |
| email                   | text        | nullable copy for display                  |
| display_name            | text        | nullable                                   |
| created_at / updated_at | timestamptz | `now()` defaults; `updated_at` via trigger |

RLS: a user can SELECT / INSERT / UPDATE **only their own row**
(`auth.uid() = id`). No delete policy (rows die with the auth user).

Rows are auto-created by the `trg_auth_users_new_user` trigger
(`20261018140500_profile_trigger.sql`), which fires on `auth.users` inserts
— app code never creates profiles directly.

### workspaces

| Column                  | Type                | Notes                            |
| ----------------------- | ------------------- | -------------------------------- |
| id                      | uuid PK             | `gen_random_uuid()`              |
| name                    | text                | `check (char_length(name) >= 2)` |
| created_by              | uuid → `auth.users` | ON DELETE SET NULL               |
| created_at / updated_at | timestamptz         | trigger-maintained               |

Indexes: `idx_workspaces_created_by`.

RLS: SELECT by members; INSERT by any authenticated user; UPDATE by
owner/admin; DELETE by owner only.

### memberships

| Column       | Type                | Notes                                      |
| ------------ | ------------------- | ------------------------------------------ |
| id           | uuid PK             | `gen_random_uuid()`                        |
| workspace_id | uuid → `workspaces` | ON DELETE CASCADE                          |
| user_id      | uuid → `auth.users` | ON DELETE CASCADE                          |
| role         | text                | `owner`/`admin`/`member`, default `member` |
| created_at   | timestamptz         |                                            |

Constraints: `unique (workspace_id, user_id)`.
Indexes: `idx_memberships_workspace_id`, `idx_memberships_user_id`.

RLS: SELECT by members of the workspace; INSERT by admins/owners **or**
self-bootstrap as `owner` when the workspace has no members yet; UPDATE /
DELETE by admins/owners **except the last owner can never be demoted or
removed** (enforced via `workspace_other_owner_count()`).

### projects

| Column                  | Type                | Notes                                       |
| ----------------------- | ------------------- | ------------------------------------------- |
| id                      | uuid PK             | `gen_random_uuid()`                         |
| workspace_id            | uuid → `workspaces` | ON DELETE CASCADE                           |
| name                    | text                | `check (char_length(name) >= 2)`            |
| description             | text                | nullable                                    |
| base_url                | text                | nullable; `check (base_url ~ '^https?://')` |
| is_archived             | boolean             | default false                               |
| created_by              | uuid → `auth.users` | ON DELETE SET NULL                          |
| created_at / updated_at | timestamptz         | trigger-maintained                          |

Constraints: `unique (workspace_id, name)`.
Indexes: `idx_projects_workspace_id`.

RLS: **all operations require workspace membership**
(`is_workspace_member(workspace_id)`) — this is what makes cross-workspace
access impossible at the database layer.

The base URL is stored as data only: nothing in the app fetches it or runs
browser tests against it.

### Helper functions (`20261018140000_core_helpers.sql`)

All `SECURITY DEFINER` with fixed `search_path = public` (policies must not
use raw subqueries on RLS tables — infinite recursion):

- `is_workspace_member(uuid)`, `workspace_user_role(uuid)`,
  `is_workspace_admin(uuid)`
- `workspace_owner_count(uuid)`, `workspace_other_owner_count(uuid, uuid)`,
  `workspace_member_count(uuid)`
- `handle_updated_at()` trigger function

## Migrations

| File                                 | Contents                                            |
| ------------------------------------ | --------------------------------------------------- |
| `20261018140000_core_helpers.sql`    | extension, trigger + RLS helper functions           |
| `20261018140100_profiles.sql`        | profiles + RLS + grants                             |
| `20261018140200_workspaces.sql`      | workspaces + RLS + grants                           |
| `20261018140300_memberships.sql`     | memberships + RLS + grants                          |
| `20261018140400_projects.sql`        | projects + RLS + grants                             |
| `20261018140500_profile_trigger.sql` | auto-creates `profiles` rows on `auth.users` insert |
| `20261018140600_project_fields.sql`  | `projects.base_url` (http(s) CHECK) + `is_archived` |

Each file carries its own canary query as a comment. Rules: up-only,
self-contained grants/RLS/policies, no destructive change without a reviewed
plan, canary-verified applies (see `docs/ARCHITECTURE.md` §4).

## Local development

- **With Docker:** `supabase start`, `supabase db reset` (migrations +
  `supabase/seed.sql`).
- **Without Docker:** plain PostgreSQL + `supabase/tests/00_auth_shim.sql`,
  then apply migration files in order with psql. Full commands in
  `supabase/tests/README.md`.
- **Seeds:** `supabase/seed.sql` inserts a demo workspace + projects
  (idempotent). Memberships/profiles need real auth users — not seeded.

## Verification

- `supabase/tests/10_core_schema_rls.sql`: **24/24 assertions passed**
  2026-10-18 on local PostgreSQL 16 — unauthenticated denied (T01–T04),
  authenticated users see only their own data (T05–T08), cross-workspace
  writes blocked (T10–T13), last-owner protection holds (T14–T15), member
  lifecycle correct (T16–T19), ownership bootstrap correct (T21–T22),
  service-role bypass confirmed (T24).
- `tests/supabase/workspace-auth.test.ts`: unit tests for the server-side
  authorization helper (mocked client).

## Not yet built

Supabase cloud project (owner's step), Auth UI (sign-in/sign-out pages),
domain tables beyond the core four (test cases, runs, results — ROADMAP
Phases 2–4).
