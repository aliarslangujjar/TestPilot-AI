# Manual Test Execution

Run existing test cases and record outcomes. UI: `/dashboard/projects/[projectId]/runs`
(list, linked from each project row) and `/dashboard/projects/[projectId]/runs/[runId]`
(detail).

Automated browser execution is **deferred** — every run created today is
`source = 'manual'`, and the UI labels it as such. The `source` column already
distinguishes the two for when the Playwright worker lands.

## Data model

**test_runs** (`20261018141000`): `id`, `workspace_id`, `project_id`,
`suite_id` (nullable — a run may cover hand-picked cases), `name` (2–100),
`source` (`manual` | `automated`, default `manual`), `status`
(`in_progress` | `completed`, default `in_progress`), `notes`, `created_by`,
`created_at`, `updated_at` (trigger), `completed_at` (set on completion,
cleared on reopen).

**run_results** (`20261018141100`): `id`, `run_id`, `workspace_id`
(denormalized for RLS), `test_case_id` (nullable FK, informational),
`snapshot` (jsonb — the frozen case, see below), `outcome`
(`unexecuted` | `pass` | `fail` | `blocked` | `skipped`, default
`unexecuted`), `notes`, `executed_by`, `executed_at`, timestamps
(trigger-maintained). Unique `(run_id, test_case_id)`.

**Snapshots:** at run creation each selected case is copied into
`run_results.snapshot` — `{ title, description, preconditions, steps,
expectedResults, priority, tags, caseStatus }`. Later edits to the test case
(including archiving) never alter the run's history; the snapshot is the
source of truth for what was executed.

**RLS:** members-only on both tables via `is_workspace_member(workspace_id)`
(select/insert/update/delete), same pattern as the other domain tables.

## Lifecycle and transitions

- Run: `in_progress` → `completed` (`completeRun`), `completed` →
  `in_progress` (`reopenRun`). Any other transition is rejected.
- Results can only be created/changed while the run is `in_progress`.
  Completing locks the run; reopening unlocks it.
- Setting an outcome stamps `executed_by`/`executed_at`; resetting to
  `unexecuted` clears them.

## Summaries and concurrency

Summaries (per-outcome counts, pass rate of executed cases) are **computed
from `run_results` at read time** — there are no denormalized counter columns
on `test_runs`. Concurrent result updates therefore cannot corrupt a summary;
each update is a single-row write and readers always aggregate current rows.

## Server actions (`lib/test-runs/actions.ts`)

| Action                      | Notes                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `listRuns`                  | Scoped to workspace + project; optional status filter; includes per-run summaries (one extra query)                                             |
| `getRun`                    | Run + summary                                                                                                                                   |
| `listRunResults`            | Results with snapshots, creation order                                                                                                          |
| `createRun`                 | Validates → membership → project/suite/case scoping → inserts run → snapshots cases → inserts results; cleans up the run if result insert fails |
| `setResultOutcome`          | Rejects when run is completed; stamps executor/time                                                                                             |
| `completeRun` / `reopenRun` | Enforce the transition map                                                                                                                      |

Every action validates input with the shared zod schemas
(`packages/schemas/src/test-run.ts`) before any database access, proves
membership via `requireWorkspaceClient` (indistinguishable denial), scopes
every query to `workspace_id` (+ project/run/result id), and relies on RLS
as the final backstop.

## UI (`components/test-runs/`)

- **Runs list** (`runs-manager.tsx`): status filter, per-run summary line,
  Manual badge, empty state, error with retry, "New run" dialog.
- **New-run dialog** (`run-form-dialog.tsx`): name, notes, suite picker,
  checkbox list of the suite's active cases (all checked by default).
- **Run detail** (`run-detail-manager.tsx`): summary bar with pass rate,
  complete/reopen, per-result cards with frozen steps in a disclosure,
  outcome selector + notes + save, locked state when completed.

## Tests

- `tests/test-runs/schemas.test.ts` — names, outcomes, statuses, case-count
  bounds, notes length.
- `tests/test-runs/actions.test.ts` — workspace isolation with the real
  `assertWorkspaceMembership` (denial without DB access, cross-workspace
  rejection); snapshot contents frozen at creation; unknown-case and
  cross-project-suite rejection; result locking on completed runs;
  complete/reopen transition map; summary aggregation; query scoping.
- `tests/test-runs/runs-manager.test.tsx`, `run-form-dialog.test.tsx`,
  `run-detail-manager.test.tsx` — list/filter/empty states, run creation
  flow, outcome saving, complete/reopen locking.

## Not built (deliberate)

- Automated runs (Playwright worker), run deletion UI, result history/audit
  per result beyond `updated_at`, assigning runs to specific testers,
  cross-suite run creation in one step (create per suite).
