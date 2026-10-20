# Contributing to TestPilot AI

Thanks for your interest in contributing! TestPilot AI is an open-source,
AI-powered QA SaaS (Next.js 16 + React 19 + TypeScript + Supabase). This
guide covers everything you need to get a change merged: setup, tests,
branching, pull requests, and how to find a first issue.

Please also read our [Code of Conduct](CODE_OF_CONDUCT.md). Security
issues follow [SECURITY.md](SECURITY.md) — never open a public issue for
a vulnerability.

## 1. Development setup

### Prerequisites

- **Node.js ≥ 20.9** and npm (see `engines` in `package.json`).
- **Supabase CLI** and **Docker** — for the local database stack.
  (Without Docker you can still run the unit/component test suite, which
  is fully mocked; DB-backed flows need the local stack.)
- A GitHub account, and a fork if you don't have write access.

### Steps

```bash
git clone https://github.com/aliarslangujjar/TestPilot-AI.git
cd TestPilot-AI
npm install
cp .env.example .env.local   # fill in locally; NEVER commit real values
supabase start               # local Postgres + Auth + Studio (Docker)
```

`supabase start` prints local credentials. Map them into `.env.local`:

| `supabase start` output | `.env.local` variable           |
| ----------------------- | ------------------------------- |
| API URL                 | `NEXT_PUBLIC_SUPABASE_URL`      |
| Publishable key         | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Secret key              | `SUPABASE_SERVICE_ROLE_KEY`     |

Then:

```bash
supabase migration up        # apply all migrations to the local stack
npm run dev                  # http://localhost:3000
```

Notes:

- `.env.example` lists every variable the app reads. AI features are
  optional locally: with no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` set,
  the AI service reports itself disabled and the rest of the app works.
- `supabase db reset` gives you a clean database (migrations + seed) but
  **wipes local data** — prefer `supabase migration up` day to day.
- Details on the data layer live in [docs/DATABASE.md](docs/DATABASE.md)
  and [docs/AUTH.md](docs/AUTH.md).

## 2. Running checks

The full quality gate — the same one reviewers expect to be green:

```bash
npm run verify   # typecheck → lint → format:check → test → build
```

Individual commands while you work:

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint
npm run format           # Prettier write (run before committing)
npm run test             # Vitest (single run)
npx vitest run tests/projects/        # one area
npx vitest run tests/projects/actions.test.ts -t "creates"   # one test
```

### Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request
and every push to `main`, and mirrors the local gate:

- `npm ci` (lockfile-strict install) with the npm cache enabled
- `npm run format:check`, `npm run lint`, `npm run typecheck`
- `npm run test` (the mocked suite — CI uses no secrets and no paid keys)
- `npm run check:migrations` (migration filename/order/duplicate checks
  that are practical without a database; `supabase migration up`
  against a real Postgres remains the semantic check)
- `npm run build` (production build)

There is **no deploy job** — CI never deploys a PR (or a merge) to
production. The workflow runs with a read-only token (`contents: read`)
and references no repository secrets; fork PRs run via `pull_request`
(never `pull_request_target`), so they cannot access secrets either.

Run the same checks locally before opening a PR:

```bash
npm run verify            # typecheck → lint → format:check → test → build
npm run check:migrations  # migration file validation
```

### Test conventions

- Tests live in `tests/`, mirroring the feature area (`lib/<area>` ↔
  `tests/<area>`).
- Unit and component tests are fully mocked — they must not need a
  network, a real database, or a paid AI API key.
- Server-action tests mock `@/lib/workspace-authz` and the Supabase
  client; component tests use Testing Library in jsdom.
- Every behavior change needs tests. Bug fixes need a regression test
  that fails without the fix.

## 3. Coding conventions

The short version (the full version is
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- TypeScript strict mode; no `any` without a justifying comment.
- Validate all external input with the shared zod schemas in
  `packages/schemas` (`@schemas/*`). Schemas are the contract between
  layers.
- Authorization is enforced by Postgres RLS plus server-side workspace
  checks (`requireWorkspaceClient`). **Never disable RLS, never expose
  the service-role key to the browser, never put secrets in client
  code.**
- Never pass functions from a Server Component to a Client Component —
  define client wrappers instead.
- Database changes are **new, timestamped migration files** in
  `supabase/migrations/` (never edit an applied migration). Every new
  table needs its own grants and RLS policies in the same migration.
  See docs/ARCHITECTURE.md §migrations.
- Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`,
  `refactor:` …

## 4. Branches and pull requests

- Branch off `main`. Branch names: `feat/<short-name>`,
  `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`.
- Keep PRs small and single-purpose — one feature or one fix per PR.
  Large changes: open an issue or draft PR first to discuss the shape.
- Fill in the PR template checklist honestly, including the
  `npm run verify` result.
- Link the issue your PR addresses (`Closes #123`).
- UI changes: include before/after screenshots in the PR description.
- Database changes: name the migration file in the PR and include the
  information_schema canary query a reviewer can run to confirm it
  applies (see existing migrations for the pattern).
- A maintainer review is required before merging. Expect feedback to
  focus on: RLS/authorization correctness, schema validation at
  boundaries, tests, and honest "implemented vs planned" claims in
  docs and UI copy.

## 5. Good first issues

New to the project? Look for the **`good first issue`** label.

What makes one: self-contained, no database migration, no auth/RLS
changes, clear acceptance criteria in the issue, and usually confined
to one feature area (a component, a docs page, a small utility, tests
for existing behavior).

How to claim one:

1. Comment on the issue saying you'd like to work on it, and ask any
   clarifying questions there before writing code.
2. One claimed issue at a time per contributor, so issues stay
   available for others.
3. If you go quiet for about a week, a maintainer may unassign the
   issue so someone else can pick it up — no hard feelings, just
   comment again if you want it back.
4. If you get stuck, say so on the issue. A partial PR with a clear
   "here's where I'm stuck" note is more useful than silence.

Other always-welcome contributions: improving docs, adding tests for
untested behavior, and reporting bugs with good reproduction steps.

## 6. What not to do

- Don't commit secrets, `.env.local`, or generated build output.
- Don't disable RLS, weaken authorization checks, or loosen the
  browser-test specification's restrictions (no arbitrary JavaScript
  execution, no navigation outside declared hosts) — these are
  load-bearing security properties, and PRs that relax them will be
  declined.
- Don't present mock/demo data or planned features as implemented.
- Don't edit applied migrations; add a new one.

## Questions

Open a regular issue with the `question` label. Response times are
best-effort — this is a small project — but questions on issues you've
claimed or PRs you've opened are the fastest way to get unstuck.
