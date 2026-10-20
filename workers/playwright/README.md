# Playwright worker

Standalone Node service that consumes `browser_jobs` (see
`supabase/migrations/20261019140000_browser_jobs.sql`), executes v1
browser-test plans (`docs/BROWSER_TEST_SPEC.md`) in isolated browser
contexts, and writes back sanitized results. Threat boundaries:
`docs/BROWSER_WORKER.md`.

## Run

```bash
npm run worker:build     # tsc → workers/playwright/dist
npm run worker:start     # build + node dist entry
```

Docker: `docker build -f workers/playwright/Dockerfile -t testpilot-worker .`

## Environment

| Variable                              | Default        | Notes                                                   |
| ------------------------------------- | -------------- | ------------------------------------------------------- |
| `SUPABASE_URL`                        | required       | Node-side only                                          |
| `SUPABASE_SERVICE_ROLE_KEY`           | required       | Node-side only — never reaches a browser                |
| `WORKER_ID`                           | `worker-<pid>` | lease attribution                                       |
| `WORKER_POLL_INTERVAL_MS`             | 5000           | idle poll interval                                      |
| `WORKER_HEARTBEAT_INTERVAL_MS`        | 30000          | lease extension                                         |
| `WORKER_LEASE_MS`                     | 300000         | claim lease; stale leases are reaped                    |
| `WORKER_JOB_TIMEOUT_MS`               | 120000         | hard cap per job                                        |
| `WORKER_MAX_CONCURRENT_PER_WORKSPACE` | 2              | run limit                                               |
| `WORKER_DAILY_JOB_LIMIT`              | 50             | run limit (per workspace, 24h)                          |
| `WORKER_MAX_SCREENSHOT_BYTES`         | 1000000        | artifact cap                                            |
| `WORKER_MAX_SCREENSHOTS_PER_JOB`      | 2              | artifact cap                                            |
| `WORKER_ALLOW_LOOPBACK`               | unset          | **Test-only.** `1` disables loopback blocking           |
| `WORKER_CHROMIUM_SANDBOX`             | on             | `0` only where the sandbox cannot run (root containers) |

## Behavior

- Atomic claims (conditional UPDATE), idempotent enqueue
  (`(workspace_id, idempotency_key)` unique).
- Retries only infra failures (crash/timeout), never assertion failures.
- Cooperative cancellation between steps.
- Stale-lease reaping on startup and throughout the loop.
