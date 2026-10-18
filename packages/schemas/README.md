# packages/schemas

Shared [zod](https://zod.dev) validation schemas used by the web app and the
Playwright worker, so both sides agree on API shapes and database row types.

Currently this holds only foundational primitives (`uuidSchema`,
`isoDateTimeSchema`, `paginationSchema`, `apiErrorSchema`). Domain schemas
(test cases, runs, results) will be added here once the product domain is
defined.

The package is consumed via the `@schemas/*` TypeScript path alias (see the
root `tsconfig.json` and `vitest.config.ts`) — no separate package manifest or
lockfile, by design. If the worker is ever extracted into its own deployable
with its own dependencies, promote this directory to a workspace package at
that point.
