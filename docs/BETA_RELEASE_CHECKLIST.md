# Beta Release Checklist

Acceptance criteria for tagging the public beta, the evidence for
each, and the blockers that remain **after** the tag (disclosed, not
hidden). The tag is applied only when every criterion in the first
table passes.

Release: **v0.1.0-beta.1** · Prepared: 2026-10-20 · Code state: `main`

## Acceptance criteria

| #   | Criterion                                                             | Evidence                                                                                                                                                                                                                                                       | Status             |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | Full quality gate green                                               | `npm run verify` (typecheck → lint → format → test → build) — 594 tests incl. the 28 release/sample scenarios                                                                                                                                                  | ⏳ final run below |
| 2   | Release scenarios pass in a clean environment                         | Fresh clone + `npm ci`, no env files: `npm run test:release` 28/28 (docs/RELEASE_READINESS.md has the method)                                                                                                                                                  | ⏳ final run below |
| 3   | README is accurate                                                    | Status, feature list, repository layout, scripts, and deployment wording reviewed against the code this pass; stale "scaffold-era" claims removed; landing page copy corrected the same day (it listed shipped features as "planned")                          | ✅                 |
| 4   | Screenshots are real                                                  | docs/images/landing.png + login.png captured 2026-10-20 from the local production build with Playwright — no mockups                                                                                                                                           | ✅                 |
| 5   | Architecture doc matches reality                                      | docs/ARCHITECTURE.md status markers reconciled (data plane, schemas, tenancy, queue — no longer marked "planned")                                                                                                                                              | ✅                 |
| 6   | Local setup instructions work                                         | README + CONTRIBUTING.md describe the verified flow (clone → `npm install` → Supabase local stack → `.env.local` key mapping); criterion 2 exercises the clone path                                                                                            | ✅                 |
| 7   | Environment documentation is complete and truthful                    | Every variable in `.env.example` cross-checked against the code's reads; a stale worker-URL/token pair (the app never calls the worker over HTTP) was removed this pass                                                                                        | ✅                 |
| 8   | Deployment guide is honest                                            | docs/DEPLOYMENT.md runbook + a dated status section that states plainly: not deployed yet, and why                                                                                                                                                             | ✅                 |
| 9   | Contributor docs present                                              | CONTRIBUTING.md, CODE_OF_CONDUCT.md (Contributor Covenant 2.1), SECURITY.md (private reporting, enabled on GitHub), issue/PR templates                                                                                                                         | ✅                 |
| 10  | License + attribution                                                 | LICENSE.md (MIT) at root; THIRD_PARTY_NOTICES.md generated from the installed tree (13 direct production dependencies, regenerable via scripts/generate-notices.mjs)                                                                                           | ✅                 |
| 11  | Demo mode + sample app                                                | `AI_DEMO_MODE=true` serves sample AI output with no key (covered by tests); examples/demo-app + sample-plan.json run green through the production worker path, guarded by tests/release/sample-app.test.ts                                                     | ✅                 |
| 12  | No secrets, personal data, private URLs, or build artifacts committed | Scan of all 335 tracked files this pass: no credential patterns, no maintainer emails/paths, no project URLs (only documented examples); one match was the public jwt.io demo token used as a redaction-test fixture. `.env.*` git-ignored (examples excepted) | ✅                 |
| 13  | Known limitations published                                           | docs/KNOWN_LIMITATIONS.md (deployment, scope, security residuals, operations)                                                                                                                                                                                  | ✅                 |
| 14  | Security posture stated without overclaiming                          | docs/SECURITY_AUDIT.md — audit complete, fixes regression-tested, residuals listed, "does not claim complete security," no live pentest exists                                                                                                                 | ✅                 |

## Final runs (filled at tagging time)

- `npm run verify`: ⏳
- Clean-environment `npm run test:release`: ⏳
- Tag: `v0.1.0-beta.1` — applied only after both runs pass.

## Remaining blockers (disclosed; they gate a _production_ launch, not this source beta)

1. **No hosted deployment.** Creating the Vercel project and the
   cloud Supabase project are owner account steps (the connected
   integration cannot create projects; free Supabase slots are in
   use). Until they exist, deployed auth/CRUD/RLS remain unverified
   against a live cloud stack — see docs/DEPLOYMENT.md.
2. **Pending migration application on the maintainer's local stack.**
   The full migration set (through
   `20261020150000_security_hardening_2.sql`) awaits the owner's
   `supabase migration up` + canary checks.
3. **Worker Docker image unbuilt.** No container host has built the
   hardened image yet; first build is a deployment-verification step
   (docs/WORKER_DEPLOYMENT.md).
4. **`INTEGRATION_ENCRYPTION_KEY` not yet set** in the maintainer's
   local environment — required before using the GitHub integration
   locally.

None of these are code defects; each is an environment/account step
with a written runbook. They are listed here so the beta tag is never
mistaken for a production launch.
