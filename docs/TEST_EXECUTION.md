# Manual Test Execution

Run existing test cases and record outcomes. UI: `/dashboard/projects/[projectId]/runs`
(list, linked from each project row) and `/dashboard/projects/[projectId]/runs/[runId]`
(detail).

Automated browser execution is **implemented** via the Playwright
worker (`docs/BROWSER_WORKER.md`). Runs with `source = 'automated'`
enqueue one browser job per test case; the worker executes the case's
saved v1 plan and writes sanitized results back to the job row, and
`refreshAutomatedRun` syncs that state into the run. Manual runs are
unchanged.

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

## Automated runs (`lib/test-runs/automated.ts`)

**Prerequisite:** each case needs a saved v1 browser plan
(`browser_plans`, migration `20261019150000`, one row per
`test_case_id`, members-only RLS). A case without a plan cannot join an
automated run — creation is refused with the case titles, never a
silent drop.

**Data additions** (`20261019150000`):

- `test_runs.execution_status` — the automation lifecycle:
  `queued | running | passed | failed | cancelled | timed_out`
  (nullable; only automated runs carry it). The manual
  `in_progress | completed` lifecycle column is untouched.
- `run_results.browser_job_id` (nullable FK, unique where set — the
  idempotency anchor: one job feeds at most one result),
  `run_results.execution_status` (same six states, nullable),
  `run_results.artifacts` (sanitized storage paths, copied from the
  worker's result, capped at 5 × 500 chars).
- `browser_jobs.run_id` / `test_case_id` (link the job to its run
  result) and `browser_jobs.failure_kind`
  (`assertion | infra | timeout`, set by the worker on final failure).

**State machine** — job → result mapping (`refreshAutomatedRun`):

| Job state                                   | Result state | Outcome |
| ------------------------------------------- | ------------ | ------- |
| `queued` (no cancel)                        | `queued`     | —       |
| `queued` + `cancel_requested`               | `cancelled`  | —       |
| `running`                                   | `running`    | —       |
| `cancelled`                                 | `cancelled`  | —       |
| `succeeded` + valid evidence                | `passed`     | `pass`  |
| `succeeded` + invalid evidence              | `failed`     | `fail`  |
| `failed` + `failure_kind = timeout`         | `timed_out`  | `fail`  |
| `failed` + `failure_kind = assertion/infra` | `failed`     | `fail`  |

The **evidence gate**: `passed` is only set when the job's stored
result parses against the result schema, reports `succeeded`, covers
exactly the plan's step count, and has every step `ok`. Anything else
is a failure — a run is **never marked passed without valid worker
evidence**. Outcomes for `cancelled` stay `unexecuted`: the test did
not run.

**Run rollup** — `running > queued > failed > timed_out > cancelled >
passed`. When every result is terminal, the run's `status` moves to
`completed` and `completed_at` is stamped once (never rewritten).

**Idempotency** — the sync only writes rows whose state actually
changes; re-syncing the same worker result is a no-op. Enqueue uses
deterministic keys (`run:<runId>:case:<caseId>`), so re-submission
cannot double-enqueue. Retries are bounded by the worker
(`max_attempts`, default 2, infra/timeout only — never assertions).

**Cancellation** — `cancelAutomatedRun` (members only): sets
`cancel_requested` via the service-role client after a membership
check (members have no UPDATE policy on `browser_jobs`), then runs a
sync pass. The worker honours cancellation before the first step, so
a flagged job can never execute again.

**Server actions** (`lib/test-runs/automated.ts`):

| Action                | Notes                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `saveBrowserPlan`     | Validates the plan against the v1 schema → membership → case scoping → upserts `browser_plans`                                          |
| `getBrowserPlan`      | Returns the plan (re-validated), or null                                                                                                |
| `createAutomatedRun`  | Validates → membership → requires a plan for every case → snapshots cases → enqueues jobs → links results to jobs; cleans up on failure |
| `refreshAutomatedRun` | Idempotent sync of job state into run state; the only path to `passed`; completes the run when all results are terminal                 |
| `cancelAutomatedRun`  | Membership-checked cancellation of non-terminal jobs via the service role, then a sync pass                                             |

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

## AI failure analysis (`docs/AI_FAILURE_ANALYSIS.md`)

Failed/timed-out automated results can be analyzed advisory-only —
analysis never changes an outcome. `lib/ai-analysis/actions.ts` builds
a bounded, sanitized evidence bundle (failing step, expected/actual,
browser error, console/network errors captured by the driver,
screenshot metadata only), then either calls the metered AI service
(hypotheses-only system prompt; output schema with
`probableClassification`, required `uncertainty`, and evidence-cited
fix suggestions) or the deterministic no-AI fallback when no provider
is configured. The analysis is persisted on the result row with its
source (`ai` | `fallback`).

## Not built (deliberate)

- Run deletion UI, result history/audit per result beyond `updated_at`,
  assigning runs to specific testers, cross-suite run creation in one
  step (create per suite).
