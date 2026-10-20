# Cost model & usage metering

How TestPilot AI measures workspace usage, what the free plan allows,
and the assumptions behind both. **Payments are deferred**: there is no
checkout, no plan tiers, and no billing integration — the configurable
free plan below is the entire model for now.

## What is metered (units)

| Resource           | Unit                                                                                                 | When it is counted                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AI calls           | 1 per structured AI request (any feature: plan generation, test-case generation, failure analysis)   | Reserved before the provider call; released if the call fails, so failed calls are never billed                                    |
| Browser runs       | 1 per browser job (i.e. per test case in an automated run)                                           | Reserved at run creation; released if run creation fails downstream                                                                |
| Execution duration | Worker-reported seconds (`finishedAt − startedAt` per job, capped at 1 hour per job)                 | Metered post-hoc, exactly once, when a result first reaches a terminal state                                                       |
| Storage            | Bytes of screenshot artifacts in the private `browser-artifacts` bucket under the workspace's prefix | Reconciled by listing object sizes when the usage page is viewed (bounded: ≤200 job folders × ≤100 files); the last value persists |

Not metered: manual test runs, page views, community template
imports, public report views (rate-limited separately), and GitHub
workflow dispatches (which have their own hourly cap — see
`docs/GITHUB_ACTIONS.md`). AI token counts are tracked separately in
the daily `ai_usage` counters (see `docs/AI_INTEGRATION.md`) for cost
visibility; the plan quota counts calls.

## Periods

Usage is tracked per workspace per **calendar month (UTC)**. A period
is identified by its first day; a new period starts with zero counters
and previous periods are retained for the history shown on the usage
page.

## Free-plan quotas (configurable)

Defaults, overridable per deployment via env (invalid values fall back
to the defaults):

| Env var                        | Default     | Meaning                      |
| ------------------------------ | ----------- | ---------------------------- |
| `USAGE_FREE_AI_CALLS`          | `200`       | AI calls per period          |
| `USAGE_FREE_BROWSER_RUNS`      | `100`       | Browser jobs per period      |
| `USAGE_FREE_EXECUTION_SECONDS` | `3600`      | Execution seconds per period |
| `USAGE_FREE_STORAGE_BYTES`     | `524288000` | Artifact storage (500 MiB)   |

## Enforcement

- **Server-side only.** Counters live in Postgres (`usage_counters`);
  the browser never writes them. Writes go through service-role RPCs
  after a membership check.
- **Race-safe.** `reserve_usage()` ensures the counter row, locks it
  (`SELECT … FOR UPDATE`) inside a single transaction, checks every
  requested amount against its limit, and increments only if all fit.
  Concurrent requests serialize on the row lock, so two requests can
  never both slip past a limit. Counters are database-backed, so this
  holds across multiple app instances.
- **Reserve before work** for AI calls and browser runs: excess work is
  rejected _before_ any provider call or job is enqueued, with a clear
  message naming the limit and the reset. Failed work releases its
  reservation.
- **Duration and storage are enforced at the gate**: their totals are
  known only after work happens, so run creation is refused once the
  already-metered execution time or the last reconciled storage total
  has reached the limit. Duration can therefore overshoot by the length
  of in-flight jobs — accepted and documented here.
- **Fail-open on metering outages.** If the metering RPC itself is
  unreachable, reservations allow the work (explicit quota denials —
  the RPC answering "no" — are always honored). A metering outage must
  not take the product down; counters also reset each period, bounding
  any drift.

## Demo mode (no paid AI)

Set `AI_DEMO_MODE=true` to run every AI feature on **locally generated
sample output**: the service builds schema-valid demo content from the
feature's own response schema, labelled as demo in its text. No
provider is called, no API key is needed, and no AI cost is incurred.
Demo calls are still metered and still count against the AI-call
quota (and the pre-existing daily quotas), so demo mode cannot be used
for unlimited scripted generation. `getAIStatus` reports
`demo: true` so the UI can be transparent about it.

## Data minimization

Counters are **workspace aggregates only**: no per-user breakdown, no
per-request event log, no prompts, responses, URLs, or file contents
are stored by metering. Storage reconciliation reads object _sizes_
only. This is deliberate — usage data should answer "how much", never
"who did what".

## Assumptions & limitations

- One plan (free) exists; the limit set is global per deployment, not
  per workspace. Per-workspace plan overrides arrive with payments.
- Storage enforcement uses the last reconciled value, which is only
  refreshed when someone views the usage page; between reconciliations
  the bucket can grow past the limit. Pruning artifacts lowers the
  total at the next reconciliation.
- Execution duration trusts the worker's timestamps (the worker is
  part of the trusted platform; its evidence is schema-validated
  before metering, and each job is capped at one metered hour).
- The SQL functions follow the project's established migration
  patterns; the row-lock contract is covered by application-level
  tests of the client contract plus quota-boundary unit tests.
