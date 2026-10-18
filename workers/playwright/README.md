# workers/playwright (planned — not implemented)

The future Playwright test-execution worker for TestPilot AI.

## Intended design

- A standalone long-running Node.js service (separate deployable from the web
  app) that pulls test-run jobs from a queue, executes them with Playwright,
  and reports results back to the web app / Supabase.
- Shares validation schemas with the web app via `packages/schemas`
  (imported through the `@schemas/*` path alias today; a workspace package if
  the worker is extracted).
- Reads its configuration from environment variables only (see the root
  `.env.example`).

## Status

Not implemented. No code, dependencies, or package manifest exist here yet —
this directory is a placeholder so the intended architecture is visible from
day one. When the worker is commissioned, expected dependencies are
`playwright`, `@supabase/supabase-js`, and `zod`.

Do not add worker code until the queue/job contract and the result-reporting
API are defined in `docs/PROJECT_CONTEXT.md`.
