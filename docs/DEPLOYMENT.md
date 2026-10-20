# Deployment — Vercel + Supabase

How TestPilot AI is deployed, environment by environment, and the
actual state of the deployment (kept honest at the bottom of this
file under **Deployment status**).

## Architecture

| Piece                     | Where it runs                          | Notes                                                                             |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| Web app (Next.js)         | Vercel (git-connected to this repo)    | Pushes to `main` deploy production; PRs and branches get previews                 |
| Database / Auth / Storage | Supabase cloud project                 | Migrations in `supabase/migrations/` are the schema source of truth               |
| Playwright worker         | A separate always-on host (NOT Vercel) | `workers/playwright/`; Vercel functions are the wrong shape for long browser jobs |
| Source of truth / CI      | GitHub                                 | GitHub Actions CI must be green before merge (see CONTRIBUTING.md)                |

There is intentionally **no `vercel.json`**: Vercel's Next.js
zero-config detection is correct for this app, and hand-written config
would only drift from it.

## Environments and variables

The same variable names exist in all three environments; values differ,
and secrets live only in dashboards — never in git, never in chat.

| Variable                                            | Local (`.env.local`)    | Preview (Vercel env, Preview)   | Production (Vercel env, Production)     | Secret?                |
| --------------------------------------------------- | ----------------------- | ------------------------------- | --------------------------------------- | ---------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                          | local stack URL         | cloud project URL               | cloud project URL                       | no                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                     | local publishable key   | cloud publishable key           | cloud publishable key                   | no (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY`                         | local secret key        | cloud secret key                | cloud secret key                        | **yes**                |
| `NEXT_PUBLIC_APP_URL`                               | `http://localhost:3000` | the preview domain              | the production domain                   | no                     |
| `AI_PROVIDER` / `AI_MODEL`                          | as desired              | as desired                      | as desired                              | no                     |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`              | your dev key            | a **separate** preview key      | a **separate** production key           | **yes**                |
| `AI_DEMO_MODE`                                      | optional                | reasonable for demos (`true`)   | leave unset                             | no                     |
| `AI_*` guards/quotas                                | defaults                | defaults                        | defaults                                | no                     |
| `PLAYWRIGHT_WORKER_URL` / `PLAYWRIGHT_WORKER_TOKEN` | local worker            | worker endpoint + token         | worker endpoint + token                 | token: **yes**         |
| `INTEGRATION_ENCRYPTION_KEY`                        | locally generated       | generate a **preview-only** key | generate a **different production** key | **yes**                |
| `USAGE_FREE_*`                                      | optional overrides      | optional                        | optional                                | no                     |

`.env.example` lists every variable with the same guidance inline.
Separate keys per environment mean a preview leak cannot touch
production; per-environment encryption keys mean preview-stored
integration secrets are unreadable in production (by design).

## Setup runbook

### 1. Supabase cloud project (one-time, owner step)

1. Create a project at supabase.com (this needs a free slot or a paid
   plan — see **Deployment status** below).
2. From a checkout with the Supabase CLI:
   - `supabase link --project-ref <ref>`
   - `supabase migration up` (applies every file in
     `supabase/migrations/` in order; day-to-day command — do **not**
     use `db reset` against the cloud, it destroys data)
   - Spot-check with the per-migration canary queries noted in the
     migration files / `docs/PHASE_STATUS.md`.
3. Authentication → URL Configuration:
   - **Site URL**: the production origin (e.g. `https://testpilot-ai.vercel.app`
     or your custom domain).
   - **Redirect URLs**: add
     - `<production origin>/auth/callback`
     - `https://*-<team-slug>.vercel.app/auth/callback` (previews)
     - `http://localhost:3000/auth/callback` (local development)
4. Authentication → Providers → Email: keep email confirmation on;
   the app's flows assume it.
5. Storage: the migrations create the private `browser-artifacts`
   bucket; confirm it exists and stays **private**.

### 2. Vercel project (one-time, owner step)

1. Vercel dashboard → Add New → Project → import
   `aliarslangujjar/TestPilot-AI`. Framework preset: Next.js (auto).
   Root directory: `./`. Production branch: `main`.
2. Environment Variables: add the Production and Preview values from
   the matrix above (paste them in the dashboard — this is the "no
   unnecessary secret sharing" rule: secrets go dashboard-to-service,
   never through chat, tickets, or git).
3. Deploy. Every later push to `main` deploys production; every PR
   gets a preview deployment automatically.

### 3. Callbacks inventory

| Callback                                                        | Where it's configured                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `<origin>/auth/callback` (Supabase email links, password reset) | Supabase redirect allowlist (step 1.3)                                                           |
| `<origin>/api/integrations/github/webhook`                      | Each GitHub repo's webhook (see `docs/GITHUB_ACTIONS.md`) — one per environment you enable it in |
| `<origin>/r/<token>` (public QA reports)                        | Nothing to configure; links embed `NEXT_PUBLIC_APP_URL` at creation time                         |

## Security settings checklist

- [ ] RLS is enabled on every table (migrations do this) and there are
      no anonymous-access policies on private data; public reads happen
      only through the token-gated public-report resolver.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` exists only in server-side env
      (Vercel) — it is never a `NEXT_PUBLIC_*` variable.
- [ ] Baseline response headers ship from `next.config.ts`
      (nosniff, referrer policy, frame deny, permissions policy, HSTS).
      Public reports add a sandboxed CSP on their own route.
- [ ] Vercel Deployment Protection: previews inherit the team's
      default; keep SSO protection on previews if the team plan allows
      it, and confirm production is public.
- [ ] GitHub: branch protection on `main` requires the CI checks;
      private vulnerability reporting stays on (see `SECURITY.md`).
- [ ] Rotate any secret in the Vercel dashboard if a person leaves the
      project; rotating `INTEGRATION_ENCRYPTION_KEY` requires
      reconnecting GitHub integrations (documented behavior).

## Health checks and error reporting

- **`GET /api/health`** returns `{ status, timestamp, environment,
checks: { database, ai } }`. `database` is `ok | not_configured |
unreachable` (probed via Supabase's auth health endpoint, 3s
  timeout); `ai` is `ok | demo | disabled`. Overall `status` is
  `degraded` (still HTTP 200) when the database isn't `ok`, so an
  uptime monitor can alert on the body while the site keeps serving.
  No secrets or internals are exposed.
- **Error reporting** is built in — no third-party SDK, nothing leaves
  the deployment: server errors are captured by
  `instrumentation.onRequestError` and client errors by the error
  boundaries via `POST /api/error-report`; both land as single-line
  structured JSON in the Vercel runtime logs
  (`lib/observability/report.ts`), each with a `reportId`. Messages and
  context are capped and allowlisted — no bodies, headers, or tokens.
  To search: Vercel project → Logs, filter by the report id or
  `"level":"error"`.

## Outage behavior (by design)

- **AI provider down/unconfigured**: AI features check status first
  and show their disabled state; a provider failure returns a typed,
  user-safe error and persists nothing. Failure analysis falls back to
  the deterministic analyzer. Demo mode (`AI_DEMO_MODE=true`) can keep
  a preview fully demonstrable with no AI spend.
- **Supabase unreachable**: the proxy treats a failed auth check as
  "signed out" — public pages keep rendering and dashboard routes
  redirect to `/login` instead of 500ing the whole site. The same
  applies when Supabase env vars are absent (fresh preview): protected
  routes gate, everything else serves, and `/api/health` says
  `not_configured`.
- **Worker down**: automated runs stay queued and the UI says so; no
  result is ever marked passed without validated worker evidence.

## Verifying a deployment

After any production deploy, check:

1. `/` loads; `/login` loads; `/dashboard` redirects to `/login` when
   signed out.
2. `/api/health` shows `database: "ok"` (once env is configured).
3. Sign up / sign in with a test account; create a workspace and a
   project; create and edit a test case (proves Auth + CRUD + RLS
   writes as the signed-in user).
4. Sign in as a different account and confirm the first account's
   project is invisible (RLS isolation).
5. `/r/<random>` returns the generic 404 page.
6. Vercel → Logs shows no `"level":"error"` entries from the pass.

## Deployment status (actual, 2026-10-20)

- ✅ **Repository readiness is complete and verified**: health
  endpoint, error reporting, security headers, proxy graceful
  degradation, per-environment env documentation; `npm run verify`
  green (539 tests) and GitHub Actions CI live.
- ⛔ **Vercel project not yet created**: creating it through the
  connected Vercel integration returned `403 — You don't have
permission to create the project` (the integration's identity cannot
  create projects), so step 2 of the runbook is an owner dashboard
  step.
- ⛔ **No cloud Supabase project exists yet** (the free plan's project
  slots are in use by other projects), so production/preview env vars
  have nothing to point at yet.
- ⛔ **Therefore deployed auth, project CRUD, and RLS are NOT yet
  verified** — they cannot be until the two steps above exist. What
  _is_ verified: the identical code and migration set run against the
  local Supabase stack, and every behavior above is covered by the
  mocked test suite. Once the owner completes runbook steps 1–2, the
  six-point verification pass in this document is the checklist to run
  (or ask for it to be run).
