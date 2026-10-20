# GitHub Actions Integration

Opt-in, per project: connect a GitHub repository workflow to a
TestPilot project and dispatch runs manually from the project's
**Actions** page (`/dashboard/projects/<id>/integrations`).

This first version covers **manual workflow dispatch** plus signed
webhook status sync. Automatic triggers (on push, on schedule) are not
implemented.

## Security model

- **The app never runs repository code.** TestPilot only calls the
  GitHub REST API — it never clones, checks out, downloads, or executes
  anything from the connected repository, and dispatch inputs are plain
  strings (bounded, schema-validated).
- **Scoped credentials.** Each integration uses a fine-grained personal
  access token scoped to **one repository** (see permissions below).
  The mapping is validated against the live API at save time: the token
  must be able to see exactly the requested repository, and the
  workflow file must exist and be active. A token that resolves to a
  different repository is rejected.
- **Secrets are encrypted and write-only.** The token and the webhook
  secret are stored AES-256-GCM encrypted
  (`github_integration_secrets`), in a table with RLS enabled and **no
  policies** — only the service role, server-side, after a workspace
  membership check, can read them. They are decrypted at the moment of
  use and are never returned to the browser. The webhook secret is
  displayed exactly once, at connect time. The encryption key lives in
  the server environment (`INTEGRATION_ENCRYPTION_KEY`, base64 32
  bytes — generate with `openssl rand -base64 32`); rotating it makes
  stored secrets unreadable, so integrations would need to be
  re-connected.
- **Authenticated callbacks.** GitHub webhooks are verified with
  HMAC-SHA256 against the per-integration secret (constant-time
  comparison) before any payload is trusted. When several integrations
  point at one repository, the secret that verifies identifies the
  integration. Invalid signatures get a 401 and nothing is recorded.
- **Duplicate-event protection.** GitHub's delivery id is recorded
  before processing; redeliveries are acknowledged as duplicates and
  applied zero additional times.
- **Rate limits.** Dispatch is capped at 20 per workspace per hour in
  the app (in-memory, per-instance), and GitHub-side 403/429 responses
  surface as a dispatch failure on the record instead of being retried
  aggressively.

## Setup

1. **Create a fine-grained token** in GitHub (Settings → Developer
   settings → Personal access tokens → Fine-grained tokens), scoped to
   the single target repository, with repository permissions:
   - **Actions: Read and write** — required (dispatch + validation).
   - **Metadata: Read** — required by GitHub for any fine-grained token.
   - **Commit statuses: Read and write** — optional; lets TestPilot
     publish the finished run's result back onto the commit.
2. **Connect in TestPilot**: project → Actions → enter owner, repo,
   workflow file name (e.g. `qa.yml`, which must use
   `on: workflow_dispatch`), default ref, and the token. Saving
   verifies the mapping live.
3. **Add the webhook in GitHub** (repo Settings → Webhooks):
   - Payload URL: `https://<your-app>/api/integrations/github/webhook`
   - Content type: `application/json`
   - Secret: the one-time secret TestPilot shows at connect time
   - Events: **Workflow runs**
4. **Dispatch** from the same Actions page: optional ref override and up
   to 10 string inputs. Status (queued → requested → in progress →
   completed + conclusion) updates as webhooks arrive; each dispatch
   links to its GitHub run.

## Status publishing

When a tracked run completes, TestPilot publishes a **commit status**
(context `testpilot/qa`, state from the run conclusion) on the run's
head SHA, targeting the authorized TestPilot project page
(`NEXT_PUBLIC_APP_URL` + the project path) — the link requires sign-in,
which keeps run details behind workspace authorization. Publishing is
best-effort: if it fails (e.g. the token lacks the Commit statuses
permission), the webhook still succeeds and a GitHub manual redelivery
(new delivery id) can retry it.

## Correlation and limitations

`workflow_dispatch` returns no run id, so runs are correlated by
webhook order: a `workflow_run` event is attached to the oldest
unmatched dispatch for that integration. Two dispatches of the same
workflow seconds apart can therefore attach in arrival order rather
than by identity — statuses still converge on completion. Runs started
from the GitHub UI are acknowledged and ignored (only TestPilot
dispatches are tracked). Dispatch inputs are visible in the GitHub UI
to anyone with repository access — never put secrets in them.
