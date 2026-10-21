# Sample demo app

A tiny, zero-dependency web application with a sign-in flow — a safe,
local **target** for TestPilot's browser worker while you evaluate the
beta. It is not part of the product: plain Node.js, no build step, no
database, nothing stored.

## Run it

```bash
node examples/demo-app/server.mjs
# → http://127.0.0.1:4321   (PORT=8080 changes the port)
```

Demo account (also printed on the sign-in page):

- Email: `demo@example.com`
- Password: `demo-password`

A wrong password shows an error; the right one lands on a dashboard.

## Test it with TestPilot

`sample-plan.json` (next to this file) is a browser-test plan in the
specification format documented in
[docs/BROWSER_TEST_SPEC.md](../../docs/BROWSER_TEST_SPEC.md): it opens
the home page, signs in with the demo account, and verifies the
dashboard. Its `baseUrl` is `http://127.0.0.1:4321` and it only allows
the loopback host.

Ways to run the plan:

- **Through the product:** with your local TestPilot stack running,
  create a project whose base URL is `http://127.0.0.1:4321`, add an
  automated test using this plan, and run it — the worker must be
  allowed loopback targets (see `WORKER_ALLOW_LOOPBACK` in
  [docs/WORKER_DEPLOYMENT.md](../../docs/WORKER_DEPLOYMENT.md)); SSRF
  protections otherwise block local addresses by design.
- **Continuously verified:** this repository's release suite executes
  this exact plan against this exact app on every run
  (`tests/release/sample-app.test.ts`, part of `npm run test:release`)
  using the production worker code path, so the sample cannot rot
  silently.

## Demo mode for the AI features

Separately from this target app, TestPilot itself has a **demo mode**:
set `AI_DEMO_MODE=true` in `.env.local` and the AI features (test
generation, failure analysis) return locally generated sample output —
no API key and no paid calls. See `.env.example` and
[docs/COST_MODEL.md](../../docs/COST_MODEL.md).
