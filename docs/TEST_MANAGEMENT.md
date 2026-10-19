# Manual Test Management

Manual QA test management: suites group test cases inside a project.
UI: `/dashboard/projects/[projectId]/suites` (linked from each project row).

AI generation and browser execution are **deferred** — test cases here are
authored and run by humans.

## Data model

**suites** (`20261018140700`): `id`, `workspace_id`, `project_id`, `name`
(2–100 chars, unique per project), `description`, `is_archived`,
`created_by`, `created_at`, `updated_at` (trigger-maintained).

**test_cases** (`20261018140800`): `id`, `workspace_id` (denormalized so RLS
and app scoping never need a join), `suite_id`, `title` (2–200 chars),
`description`, `preconditions`, `steps` (jsonb array of
`{ "action": string, "expected": string | null }`, max 100), `expected_results`,
`priority` (`low` | `medium` | `high` | `critical`, default `medium`), `tags`
(`text[]`, max 20), `status` (`draft` | `active`, default `draft`),
`is_archived`, `created_by`, `created_at`, `updated_at` (trigger-maintained).

**RLS:** members-only on both tables via `is_workspace_member(workspace_id)`
(select/insert/update/delete), same pattern as projects.

**Archiving preserves history:** `is_archived` only hides rows from the
default list. Archived suites and cases remain fully readable (via "Show
archived") and are never deleted. Duplicating a suite copies its
non-archived cases; duplicates start unarchived (cases start as `draft` for
review) while sources are untouched.

## Server actions

`lib/suites/actions.ts` and `lib/test-cases/actions.ts` (`"use server"`,
user session):

| Action                                              | Notes                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `listSuites` / `getSuite`                           | Scoped to workspace + project; optional search/archived                                       |
| `createSuite` / `updateSuite`                       | Zod-validated; duplicate names → friendly message                                             |
| `setSuiteArchived`                                  | Soft archive/restore                                                                          |
| `duplicateSuite`                                    | Copies suite + non-archived cases as drafts                                                   |
| `listTestCases`                                     | Scoped to workspace + suite; filters: search, status, priority, tags (`&&` overlap), archived |
| `getTestCase` / `createTestCase` / `updateTestCase` | Zod-validated                                                                                 |
| `setTestCaseArchived`                               | Soft archive/restore; history stays readable                                                  |
| `duplicateTestCase`                                 | Copy as draft in the same suite                                                               |

**Permission enforcement, on every operation:**

1. Input validated with the shared zod schemas (`packages/schemas/src/suite.ts`,
   `packages/schemas/src/test-case.ts`) before any database access.
2. `requireWorkspaceClient` (`lib/workspace-authz.ts`) proves membership —
   unknown workspace, non-member, malformed id, and signed-out callers all get
   the same indistinguishable denial.
3. Every query is scoped with `.eq("workspace_id", …)` (plus project/suite/id);
   a missing row reads as "not found", never as a cross-workspace leak.
4. Parent scoping: suite actions verify the project belongs to the workspace;
   case actions verify the suite belongs to the workspace.
5. RLS remains the final backstop.

Search input is LIKE-escaped. `lib/projects/actions.ts` was refactored to use
the same shared `requireWorkspaceClient` helper.

## UI (`components/test-management/`)

Two-panel layout: suites on the left, the selected suite's cases on the right.

- Suite panel: search, "show archived", create/edit/duplicate/archive with
  two-step archive confirmation.
- Case panel: search by title, status/priority/tag filters (tag options derive
  from loaded cases), "show archived", create/edit/duplicate/archive, detail
  view.
- Case form: title, priority, status, tags (comma-separated), description,
  preconditions, ordered steps editor (action + optional expected per step,
  add/remove), expected results. Instant client-side zod validation; server
  errors surface in the dialog.
- Detail view: badges, tags, numbered steps with per-step expectations,
  timestamps.
- States throughout: skeleton loading, empty (none vs. no matches),
  dismissible success notices (`role="status"`), error banner with retry
  (`role="alert"`).

## Tests

- `tests/test-management/schemas.test.ts` — validation rules (names, steps
  shape/limits, priorities, statuses, tags).
- `tests/test-management/actions.test.ts` — workspace isolation with the real
  `assertWorkspaceMembership`: denial without data access, cross-workspace
  project/suite rejection, workspace+project+suite+id scoping, archived
  filtering, LIKE escaping, duplicate-name handling, archive-preserves-history,
  duplication semantics.
- `tests/test-management/test-management.test.tsx` — UI: loading, empty
  states, suite/case creation, archive confirmation.

## Not built (deliberate)

- Deleting suites or cases (archive is the only removal path).
- AI-generated cases, browser execution, test runs/results.
- Case reordering (array order is creation order) and cross-suite moves.
