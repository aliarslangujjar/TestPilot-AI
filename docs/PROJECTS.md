# Projects

Project CRUD for organizing test runs. UI: `/dashboard/projects`.

## Data model

`public.projects`: `id`, `workspace_id`, `name` (2–100 chars, unique per
workspace), `description`, `base_url` (optional, http(s) only — enforced by
both the zod schema and a `CHECK` constraint), `is_archived`, `created_by`,
`created_at`, `updated_at` (auto-maintained by trigger).

The base URL is **stored as data only**. Nothing in the app fetches it, pings
it, or executes browser tests against it — the Playwright worker remains a
placeholder (see `docs/ROADMAP.md`).

## Server actions (`lib/projects/actions.ts`)

All run on the server (`"use server"`) against the user's own session:

| Action               | What it does                                                                     |
| -------------------- | -------------------------------------------------------------------------------- |
| `listProjects`       | Lists active projects (newest first); optional name search and `includeArchived` |
| `getProject`         | Fetches one project                                                              |
| `createProject`      | Validates input, inserts, records the creator                                    |
| `updateProject`      | Validates input, updates name/description/base URL                               |
| `setProjectArchived` | Soft-archives or restores (never deletes)                                        |

**Permission enforcement, on every operation:**

1. Input is validated with the shared zod schemas (`packages/schemas/src/project.ts`) before any database access.
2. `assertWorkspaceMembership` runs against the real implementation — unknown workspace, non-member, malformed id, and signed-out callers all get the same indistinguishable denial.
3. Every query is scoped with `.eq("workspace_id", workspaceId)` (and `.eq("id", projectId)` for single-row ops), so a missing row reads as "not found", never as a cross-workspace leak.
4. RLS remains the final backstop for the anon-key client.

Search input is escaped before `ilike` so `%` and `_` can't alter the pattern. Duplicate names per workspace return a friendly message (unique-violation `23505`).

## UI (`components/projects/`)

- `ProjectsManager`: search (debounced, server-side), active/archived toggle, table with view/edit/archive/restore, two-step archive confirmation.
- States: skeleton loading, empty (no projects vs. no matches), dismissible success notices (`role="status"`), error banner with retry (`role="alert"`).
- `ProjectFormDialog`: create/edit with instant client-side zod validation; server errors surface inside the dialog.
- `ProjectDetailDialog`: read-only view with timestamps.

The page resolves the workspace via `getCurrentWorkspace()` (earliest-joined; no workspace switcher UI yet). With no membership, it shows guidance instead of the manager. Every action re-asserts membership server-side regardless.

## Tests

- `tests/projects/project-schemas.test.ts` — validation rules.
- `tests/projects/actions.test.ts` — ownership boundaries: validation-before-DB, non-member/signed-out denial without project access, workspace+id scoping on update/archive/get, archived filtering, LIKE escaping, per-workspace duplicate names.
- `tests/projects/projects-manager.test.tsx` — loading, empty, error+retry, search, create success/validation error, archive confirmation, detail view.

## Not built (deliberate)

- Deleting projects (archive is the only removal path).
- Workspace creation / switching UI.
- Fetching the base URL or executing browser tests.
