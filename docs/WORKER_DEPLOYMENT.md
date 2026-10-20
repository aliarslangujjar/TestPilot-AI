# Playwright worker — deployment, rollback, recovery

The worker is a standalone Node process that polls the `browser_jobs`
queue in Supabase, executes v1 browser plans in isolated Chromium
contexts, and writes sanitized results back. It is **never** deployed
to Vercel and **never** runs inside a web request handler — the web app
only enqueues job rows (a test enforces this boundary:
`tests/worker/vercel-boundary.test.ts`). Threat model and execution
rules live in the worker README and `docs/ARCHITECTURE.md`; this
document is the operations guide.

## Image

- **Base**: `mcr.microsoft.com/playwright:v1.64.1-noble` — one tag pins
  Playwright 1.64.1, its bundled Node 22.x, and the Chromium build
  together. `package.json` and `browser-pin.ts` must match; the worker
  refuses to start on a mismatch. For maximum rigor, pin the base by
  digest (`docker buildx imagetools inspect …` → `name@sha256:…`).
- **Two stages**: build (full `npm ci`, compiles TypeScript) → runtime
  (`npm ci --omit=dev`, compiled output only — no compiler ships).
  Dependencies always come from the committed lockfile.
- **Non-root**: runs as uid 10001 (`tpworker`); Chromium sandbox stays
  **on**. Compose adds `cap_drop: ALL`, `no-new-privileges`,
  read-only root filesystem, and memory/CPU limits.
- Build (from the repo root) and tag every image with the git SHA:
  `docker build -f workers/playwright/Dockerfile -t testpilot-worker:$(git rev-parse --short HEAD) .`

## Run (reference: `workers/playwright/docker-compose.yml`)

1. `cp workers/playwright/.env.worker.example workers/playwright/.env.worker`,
   fill it in, `chmod 600`. On managed hosts, inject the same
   variables from the platform secret store instead of a file.
2. `docker compose -f workers/playwright/docker-compose.yml up -d`
3. Confirm: container health check turns healthy; the worker log shows
   `worker <id> started (node …, chromium …)`; `/healthz` answers.

### Credentials

The worker needs exactly one secret: `SUPABASE_SERVICE_ROLE_KEY`
(bypasses RLS — treat it accordingly). It lives only in the worker's
environment, is used only by the Node-side Supabase client, and is
never passed to a browser context, a page, a log line, or a result.
Rotate it in the Supabase dashboard, update the secret store/env
file, and restart the worker — no image rebuild is involved.

### Configuration (env; defaults)

| Variable                                                         | Default     | Meaning                                   |
| ---------------------------------------------------------------- | ----------- | ----------------------------------------- |
| `WORKER_POLL_INTERVAL_MS`                                        | 5000        | Queue poll cadence                        |
| `WORKER_LEASE_MS`                                                | 300000      | Job lease; expiry makes a job reapable    |
| `WORKER_JOB_TIMEOUT_MS`                                          | 120000      | Hard cap per job                          |
| `WORKER_MAX_CONCURRENT_PER_WORKSPACE`                            | 2           | Per-workspace parallel jobs (all workers) |
| `WORKER_DAILY_JOB_LIMIT`                                         | 50          | Per-workspace jobs per day                |
| `WORKER_MAX_PARALLEL_JOBS`                                       | 1           | Lanes inside one worker process (max 8)   |
| `WORKER_MAX_SCREENSHOT_BYTES` / `WORKER_MAX_SCREENSHOTS_PER_JOB` | 1000000 / 2 | Artifact caps                             |
| `WORKER_HEALTH_PORT`                                             | 8080        | `/healthz` + `/metrics` (0 disables)      |
| `WORKER_SHUTDOWN_TIMEOUT_MS`                                     | 30000       | Drain grace after SIGTERM                 |
| `WORKER_CHROMIUM_SANDBOX`                                        | on          | Set `0` only where userns is unavailable  |
| `WORKER_ALLOW_LOOPBACK`                                          | off         | **Test-only** SSRF escape hatch           |

Scale out by adding worker replicas and/or raising lanes; per-workspace
caps are enforced in the claim path, so replicas cannot oversubscribe
a workspace. Size memory ≈ 2 GiB for 1–2 lanes (one Chromium).

## Health, metrics, logs

- `GET /healthz` → 200 `{status:"ok", workerId, startedAt,
uptimeSeconds, inFlight, lastPollAt, lastJobFinishedAt}`; flips to
  **503 `shutting_down`** the moment shutdown begins. The image's
  Docker `HEALTHCHECK` and the compose healthcheck use it.
- `GET /metrics` → Prometheus counters:
  `testpilot_worker_jobs_claimed_total`,
  `testpilot_worker_jobs_finished_total{outcome}`,
  `testpilot_worker_runner_errors_total`,
  `testpilot_worker_in_flight`, `testpilot_worker_uptime_seconds`.
  Keep the port on the internal network only (compose leaves it
  unpublished by default).
- Logs are single-line and sanitized (`sanitizeError`: first line only,
  control characters stripped, capped) — job ids and outcomes, never
  page content, URLs with parameters, or credentials. Compose caps log
  size with rotation.

## Graceful shutdown

SIGTERM/SIGINT → health flips to 503, lanes stop claiming, in-flight
jobs drain for up to `WORKER_SHUTDOWN_TIMEOUT_MS`, then the browser
closes and the process exits 0. If the grace elapses, it exits 1 and
unfinished jobs are recovered (below). Container stop grace
(`stop_grace_period: 45s` in compose) must exceed the drain grace.

## Rollback

The worker is stateless; rollback is an image swap:

1. `docker compose … up -d` with the previous `testpilot-worker:<sha>`
   tag (keep at least the last few SHA tags in the registry).
2. No database rollback: migrations are forward-only, and consecutive
   worker versions read the same queue schema. If a bad worker wrote
   bad results, the affected runs can be re-queued from the app by
   creating a new run — results are never edited in place.

## Recovery

- **Crash / SIGKILL mid-job**: the job's lease expires
  (`WORKER_LEASE_MS`), the next poll reaps it back to `queued` (or
  `failed` once `max_attempts` is exhausted); retries happen only for
  infrastructure failures, never for assertion failures. A crashed
  worker therefore never wedges the queue.
- **Poison job** (crashes every worker): attempts increment per claim,
  so it fails permanently at `max_attempts` instead of looping.
- **Supabase outage**: the poll loop logs a sanitized error, backs off
  one poll interval, and continues; jobs simply wait in the queue.
- **Stuck queue triage**: inspect `browser_jobs` by status — `queued`
  with no worker heartbeat means no worker is running; `running` with
  expired leases means workers died ungracefully (check container
  logs); rising `failed` with `failure_kind = 'infra'` points at the
  network guard or target reachability.

## End-to-end verification

`npm run worker:e2e` runs the production path (policy authorization →
atomic claim → real Chromium behind the real SSRF guard → sanitized
result + artifact upload) against an **authorized staging target**: a
throwaway login app the harness itself serves on loopback (the
test-only loopback flag exists for this). Verified 2026-10-20 in the
build sandbox: all five steps (goto, fill, click, assertUrl,
assertText) passed; `/healthz` and `/metrics` answered correctly; a
failure-path run confirmed screenshot capture + upload. An optional
external pass (`E2E_EXTERNAL=1`) targets `https://example.com`; in
that sandbox it was blocked by the sandbox's own browser egress
(`ERR_TUNNEL_CONNECTION_FAILED`) — an environment limit, not a worker
defect. A queue-driven E2E against a staging Supabase follows the same
harness shape with the real store.

Note: the Docker image itself could not be built in the authoring
sandbox (no Docker there); the Dockerfile follows the same commands
verified locally (`npm ci`, `npm run worker:build`, node entrypoint)
and its build is exercised the first time it runs on a container host
— treat the first host build as part of deployment verification.
