# Release-Readiness Test Suite

A scenario suite that exercises TestPilot's release-critical paths
the way a first user hits them, plus the failure modes a release
must survive. It lives in `tests/release/` and runs with:

```bash
npm run test:release        # just this suite
npm test                    # it is part of the full suite too (and of CI's verify job)
```

## Design rules

- **No paid AI.** Providers are mocked at the two seams the product
  itself defines (the `ai` SDK module and `lib/ai/service`). Dummy
  keys only; the outage scenarios assert the provider mock's call
  counts, so an accidental real call would fail the test.
- **No production data.** App scenarios run against a shared
  in-memory data plane (`tests/release/fake-app-db.ts`); browser
  scenarios run against the project's own loopback demo app (the
  worker fixture server). Nothing leaves the machine.
- **Real gates, fake transport.** The workspace authorization chain
  (`requireWorkspaceClient` → `assertWorkspaceMembership`) runs for
  real in front of the fake backend; only the Supabase transport is
  substituted. Browser execution is fully real: production
  `processJob` → policy → Playwright driver → Chromium.

## Coverage matrix

| Commissioned area             | Scenario file                                                   | What is exercised                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup                        | `signup.test.tsx`                                               | Real auth form, sign-up mode: success enters the app; duplicate-account rejection surfaces; invalid email blocked before any auth call                                                                                      |
| Workspace/project creation    | `journey.test.ts`                                               | Create workspace (owner bootstrap verified), project, and suite through the real actions                                                                                                                                    |
| Manual cases                  | `journey.test.ts`                                               | Hand-written case created and listed alongside generated ones                                                                                                                                                               |
| Mocked AI generation          | `journey.test.ts`                                               | `generateTestPlan` with the provider seam mocked returns reviewable drafts                                                                                                                                                  |
| Human review                  | `journey.test.ts`                                               | Approve 2 of 3 drafts, reject 1 (unverified assumption); only approved drafts become test cases                                                                                                                             |
| Real Playwright execution     | `execution.test.ts`                                             | Full login flow against the demo app through the worker path; per-step results stored                                                                                                                                       |
| Result evidence               | `execution.test.ts`                                             | Failing assertion → `failure_kind=assertion`, failed-step detail, and a screenshot artifact uploaded under the job prefix                                                                                                   |
| Worker timeouts               | `execution.test.ts`                                             | Step timeout vs a hanging page (bounded, no worker hang); job-level timeout classified `failure_kind=timeout`                                                                                                               |
| Mocked failure analysis       | `ai-failure-modes.test.ts`                                      | AI disabled → deterministic fallback stored and labelled (confidence ≤ 0.6); provider down → clean error, nothing stored; non-failed results refused                                                                        |
| Provider outages (generation) | `ai-failure-modes.test.ts`                                      | SDK throws 503 → typed `AIServiceError`, usage reservation **released** (reserve→release, no meter), non-member never reaches the provider                                                                                  |
| Public report sharing         | `public-report.test.ts`                                         | Create → anonymous resolve serves the sanitized snapshot with real totals → revoke → link indistinguishable from nonexistent; hash-only token storage asserted                                                              |
| Revocation & expiry           | `public-report.test.ts`                                         | Malformed/unknown tokens and expired reports all resolve `not_found`                                                                                                                                                        |
| Cross-workspace denial        | `journey.test.ts`, `public-report.test.ts`, `execution.test.ts` | Non-member denied on actions, report create/revoke, and worker job authorization — with zero writes and zero provider calls as the assertion                                                                                |
| Invalid inputs                | `invalid-inputs.test.ts`                                        | Empty names, `javascript:`/`ftp:`/protocol-relative base URLs, malformed cases, bad generation requests, ghost review approvals, unsupported report expiry, `file://` browser plan — each rejected **with no rows written** |
| Permission failures           | `journey.test.ts`, `ai-failure-modes.test.ts`                   | Signed-out callers and non-members denied indistinguishably before any work happens                                                                                                                                         |

## Actual results — 2026-10-20

**Clean-environment run** (the commission's requirement): a fresh
`git clone` of commit `d3bd7f5` into an empty directory, `npm ci`
(282 packages), no `.env` files, no build artifacts, then
`npm run test:release`:

- **26/26 tests passed** (6 files) in ~17 s wall clock.
- Full in-repo gate the same day: `npm run verify` green —
  **592/592 tests** (566 existing + these 26), typecheck, lint,
  format, and production build all passing.
- Environment: Node v24.20.0, Playwright Chromium (project-pinned
  build, machine cache), Linux. Execution scenarios take ~9 s of
  the suite (real browser); they `skipIf` cleanly when no Chromium
  is present, so the suite still passes on machines without one —
  with the browser coverage reported as skipped, never as passed.

**Defect found by this suite (fixed in the same commit):** the
Playwright driver's failure-screenshot call had no timeout. Against
a page stuck mid-navigation it blocked for the full ~30 s protocol
timeout per failed step (the hanging-page scenario exposed it). The
screenshot is now capped at 5 s; the scenario completes in ~6 s
(800 ms step timeout + bounded evidence capture).

## CI guidance

The suite runs inside the existing CI `verify` job via `npm test`.
Two notes for whoever extends `ci.yml`:

1. The browser scenarios need a Chromium: add
   `npx playwright install --with-deps chromium` before the test
   step to get execution coverage in CI; without it they skip.
2. Nothing in this suite needs secrets, network egress, or a
   Supabase project. Do not give it any: paid AI and production data
   stay out by construction, not by configuration.

## Honest limitations

- The Supabase **transport** is substituted in app scenarios. RLS
  policy SQL is covered by the security audit and the dedicated
  authorization tests, but this suite does not execute against a
  live Postgres; a live-database smoke pass remains part of
  deployment verification (`docs/DEPLOYMENT.md`).
- Signup is exercised at the form level with a mocked auth client.
  A real Supabase signup → email-confirmation round trip needs a
  deployed stack and is likewise a deployment-verification item.
- The "authorized demo app" is the project's loopback fixture
  application — the same target the worker E2E uses. It proves the
  execution pipeline, not any external site's compatibility.
- Provider outages are simulated at the SDK seam (a thrown 503).
  Real provider behavior under degradation may differ; the suite
  pins the _contract_ (typed error, reservation released, nothing
  silently stored), not the provider.
