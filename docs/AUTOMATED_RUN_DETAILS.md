# Automated Run Details

Automated runs (`source = "automated"`) get a dedicated detail view at
`/dashboard/projects/[projectId]/runs/[runId]`, separate from the manual
outcome editor. All data comes from the worker-recorded evidence — this
page never invents results.

## What the detail shows (lib/run-details/details.ts)

`getAutomatedRunDetail(workspaceId, projectId, runId)`:

- **Status + duration** — run execution status and wall-clock duration
  (`completed_at − created_at`), plus per-case duration from the job's
  recorded `startedAt`/`finishedAt`.
- **Execution summary** — passed / failed / timed_out / cancelled /
  running / queued counts.
- **Per-test results** — per-step table (action, ok, duration, sanitized
  error), **failed steps** highlighted, **expected vs. actual** for
  failed/timed-out cases (taken from the same validated evidence bundle
  the AI analysis consumes — one source of truth), and **sanitized logs**
  (console/network errors, re-sanitized on the way out as defense in
  depth against worker sanitizers written before a fix).
- **Artifact metadata** — storage paths only. Binaries never leave
  storage except through short-lived signed URLs (below).
- **AI analysis** — the stored envelope from `analyzeRunFailure`, if any,
  including its uncertainty. The "Analyze failure" button runs analysis
  on demand and merges the result locally.

Manual runs are refused (`Test run not found` — same treatment as a
missing run).

## Artifact binaries: storage, signed URLs, retention (lib/run-details/artifacts.ts)

Binaries (failure screenshots) live in the **private**
`browser-artifacts` bucket (`<workspaceId>/<jobId>/step-<n>.png`); the
database holds only paths as metadata.

Downloads go through `getArtifactSignedUrl(workspaceId, projectId, runId,
artifactPath)`:

1. caller is a workspace member (`requireWorkspaceClient`);
2. the path is well-formed — `<workspaceId>/…`, no `..`, no backslashes,
   no empty segments, and the first segment must be the caller's
   workspace id (kills traversal and same-workspace prefix confusion);
3. the path is actually **referenced by a job linked to this run**
   (`run_results.artifacts @> path`) — membership of one workspace never
   reaches another workspace's files;
4. only then is a signed URL minted via the service role.

URLs live **5 minutes** (`ARTIFACT_URL_TTL_SECONDS`). Missing or expired
objects return a clean "Artifact not found or expired." — never a hint
about whether the object exists.

**Size limits** are enforced at upload time by the worker (≤1MB per
screenshot, ≤2 per job; see `docs/BROWSER_WORKER.md`). **Retention** is
30 days (`ARTIFACT_RETENTION_DAYS`); `pruneBrowserArtifacts` deletes
expired binaries in bounded batches (max 100 per call), skips files it
cannot age, never descends below the workspace prefix, and refuses
retention values under 7 days. Run it on a schedule (cron) or on demand
from an admin tool — there is intentionally no UI button for it.

**Traces are not captured, by design.** Playwright traces can embed
secrets; the worker deliberately records screenshots only. The detail UI
says this plainly next to the artifact list.

## Run comparison (lib/run-details/compare.ts)

`compareAutomatedRuns(workspaceId, projectId, baseRunId, otherRunId)`
matches results across two automated runs of the same project by
`test_case_id` (falling back to the snapshot title when the case was
deleted) and classifies each case:

| base → other                                  | classification  |
| --------------------------------------------- | --------------- |
| bad → good                                    | fixed           |
| good → bad                                    | regressed       |
| bad → bad (failed/timed_out, in either order) | still_failing   |
| good → good                                   | unchanged       |
| missing in one run                            | added / removed |
| anything else (queued, running, cancelled…)   | changed_other   |

Durations are included per matched case with a delta (positive when the
other run was slower). Comparing a run to itself, or across projects, is
rejected.

## Status

- UI surface is new; nothing here has run against a live Supabase queue
  yet — worker not deployed, so treat all artifacts/flows as code-complete
  but unexercised end-to-end.
- No migration was needed: all reads use existing columns
  (`run_results.artifacts`, `failure_analysis`, `execution_status`).
