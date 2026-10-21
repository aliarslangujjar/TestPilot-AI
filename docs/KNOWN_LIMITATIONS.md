# Known Limitations — Public Beta

What TestPilot AI's beta does **not** do yet, stated plainly. This
list is part of the beta's honesty contract: if something here matters
to you, it is a reason to wait, self-host carefully, or contribute —
not something to discover in production. Security-specific residual
risks live in [SECURITY_AUDIT.md](SECURITY_AUDIT.md); deployment
status lives in [DEPLOYMENT.md](DEPLOYMENT.md).

## Deployment & verification

- **No hosted instance exists yet.** The beta is a source release:
  you run it yourself (Vercel + Supabase + a worker host, per
  [DEPLOYMENT.md](DEPLOYMENT.md)). The maintainers' own cloud
  deployment is blocked on owner-side account steps, so **deployed
  auth, CRUD, and RLS have not been verified against a live cloud
  stack** — they are verified by the automated suite (592 tests) and
  a local Supabase stack instead.
- **Migrations are pattern-verified, not live-applied, in CI.** Every
  migration ships with a canary query; applying them
  (`supabase migration up`) and checking the canaries is part of
  setting up any real environment.
- **The worker's Docker image has not been built on a container
  host yet.** The Dockerfile and hardening are written and reviewed;
  the first build is part of deployment verification
  ([WORKER_DEPLOYMENT.md](WORKER_DEPLOYMENT.md)). Until then, run the
  worker directly with Node.js.

## Product scope

- **No payments or paid plans.** Usage metering and free-plan quotas
  exist; billing does not. Quotas are enforced per workspace per
  month; there is no upgrade path in the beta.
- **Browser tests are a constrained specification, by design.**
  Plans use a closed action set with accessibility-first locators —
  no arbitrary JavaScript, no CSS/XPath selectors, no shell commands.
  If you need full Playwright code, this is not that tool.
- **Traces are not captured.** Evidence is per-step results plus
  screenshots. There is no video recording and no trace viewer.
- **Failure analysis is assistive, not authoritative.** When AI is
  unavailable it falls back to deterministic heuristics, clearly
  labelled, with capped confidence. Treat its root-cause labels as
  triage hints.
- **AI providers are OpenAI and Anthropic only**, behind one service
  interface. Demo mode (`AI_DEMO_MODE=true`) removes the key
  requirement with locally generated sample output.
- **GitHub Actions integration is dispatch-and-observe**: manual
  workflow dispatch, webhook completion tracking, and a commit
  status. It does not clone or execute repository code.

## Security posture (summary)

- A scoped security audit was performed and its confirmed findings
  fixed with regression tests ([SECURITY_AUDIT.md](SECURITY_AUDIT.md)).
  It was **not** a live penetration test — no deployed stack existed
  to test — and the project does not claim complete security.
- Known residuals include: no global Content-Security-Policy header
  yet, a theoretical SSRF DNS-rebinding (TOCTOU) window mitigated by
  per-request host enforcement, in-memory (per-instance) rate
  limiters, and aggregate workspace member-count visibility on one
  usage RPC (accepted with rationale in the audit).

## Data & operations

- **Rate limiting is per-instance in-memory.** Multi-instance
  deployments get per-instance limits, not global ones.
- **Error reporting is intentionally minimal** (structured, self-
  hostable, no third-party SDK). There is no built-in alerting.
- **No data export/import tooling** beyond the community template
  library's import-as-draft flow.
- **Accessibility and i18n:** the UI is English-only; accessibility
  follows the component library's semantics and has not had a
  dedicated audit.

## What "beta" means here

The feature set is complete for the core loop — manage tests,
generate with AI under human review, execute in a real browser,
share results — and is covered by an automated suite that runs in
CI. The beta label marks the gap between _code-verified_ and
_deployment-proven_: expect to be your own operator, read the
runbooks, and report what breaks.
