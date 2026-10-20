# TestPilot AI — Browser Worker: Threat Boundaries

The worker (`workers/playwright/`) is the most exposed component in the
system: it runs an attacker-reachable browser against network targets on
behalf of workspace members. This document names the threats, the
mitigations, and the residual risks. Read it before changing worker code.

## Trust boundaries

```
[member] --(RLS + server actions)--> [browser_jobs queue]
[worker] --(service role, re-validates everything)--> [browser_jobs queue]
[worker] --(spec actions only, no secrets, network guard)--> [browser context]
[browser] --(plan allowlist + SSRF guard)--> [target site]
```

The worker trusts the queue for _scheduling_ and nothing else. Payloads,
authorization, limits, and destinations are re-validated worker-side.

## Threats and mitigations

| Threat                                                 | Mitigation                                                                                                                                                                                                                                                 | Residual risk                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious/malformed plan                               | `parseBrowserTestPlan()` in the worker; unknown actions, smuggled `evaluate`/`exec` keys, unknown options, oversized plans all fail closed. There is no code path that executes a string from the plan.                                                    | None known: the spec has no code-expression mechanism.                                                                                                    |
| Model-generated shell commands                         | No such action exists; the worker never shells out per job.                                                                                                                                                                                                | None: the worker's only subprocess is the browser itself.                                                                                                 |
| SSRF to private/loopback/link-local/cloud metadata     | Per-request DNS resolution + IP-range checks (10/8, 172.16/12, 192.168/16, 127/8, ::1, fe80::/10, fc00::/7, 169.254/16) + hostname denylist (`localhost`, `*.localhost`, `metadata.google.internal`, …). Every redirect hop is re-resolved and re-checked. | DNS rebinding inside the 30s cache TTL; a hostname the user allowlists that resolves to a private IP (still blocked by the IP check — by design).         |
| DNS rebinding on redirect                              | Redirects re-fire the route handler; each hop is re-resolved.                                                                                                                                                                                              | See TTL note above.                                                                                                                                       |
| Secret exfiltration to the browser                     | The service-role key lives only in Node (`store.ts`); contexts are created with no `extraHTTPHeaders`, no storage state, no init scripts; no `page.evaluate` exists in the driver (asserted by a source test).                                             | A compromised target page could read what the _plan_ types into it (fill values) — that is the test's purpose; don't put real credentials in fill values. |
| Resource exhaustion (one workspace hogging the worker) | Per-workspace concurrency cap (default 2) and daily quota (default 50/24h), re-checked before each claim; per-job timeout (default 120s); per-step timeout (≤30s); ≤50 steps per plan.                                                                     | Caps are best-effort across multiple workers (check-then-claim race).                                                                                     |
| Artifact bombs                                         | Failure screenshots only (no traces — traces can embed secrets), ≤1MB each, ≤2 per job, viewport PNG.                                                                                                                                                      | None significant.                                                                                                                                         |
| Double execution                                       | Idempotent enqueue (`(workspace_id, idempotency_key)` unique); atomic claims (conditional UPDATE on `status='queued'` — exactly one worker wins).                                                                                                          | A job that crashes _after_ side effects on the target can't be un-run; retries are infra-only.                                                            |
| Worker crash mid-job                                   | Leases with heartbeats; stale leases are reaped to `queued` (or `failed` when attempts are exhausted).                                                                                                                                                     | A crash between the last heartbeat and completion may re-run a nearly-finished job once.                                                                  |
| Runaway job                                            | Hard job timeout kills the run (infra failure → retry policy).                                                                                                                                                                                             | The timed-out browser context is closed; in-flight requests may briefly outlive it.                                                                       |
| Privilege escalation in the container                  | Non-root user in Docker, Chromium sandbox on by default.                                                                                                                                                                                                   | `WORKER_CHROMIUM_SANDBOX=0` exists for sandbox-less environments — using it in production voids this boundary.                                            |
| Stale authorization (member removed while queued)      | Worker re-checks workspace existence, project membership, and creator membership at run time.                                                                                                                                                              | A member removed _during_ execution keeps the current run; the next job is denied.                                                                        |

## What the worker will NOT do

- Execute arbitrary JavaScript (`page.evaluate` does not appear in the driver).
- Run shell commands, read files, or make non-browser network calls per job.
- Send production secrets to a browser context (no headers, no init scripts, no storage state).
- Claim a test has executed unless its steps actually ran (results record per-step outcomes).
- Retry assertion failures (deterministic — retrying would just re-fail).
- Exceed its configured timeouts, artifact caps, or workspace quotas.

## Changing the pin

Bump `package.json`'s `playwright` (exact, no `^`), `PINNED_PLAYWRIGHT_VERSION`
in `workers/playwright/src/browser-pin.ts`, and the Dockerfile base image tag
together. A unit test asserts the first two match; the worker refuses to
start on any mismatch.
