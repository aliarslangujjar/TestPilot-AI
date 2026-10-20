# TestPilot AI

[![CI](https://github.com/aliarslangujjar/TestPilot-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/aliarslangujjar/TestPilot-AI/actions/workflows/ci.yml)

Open-source AI-powered QA SaaS.

> **Status:** active development. Projects, test management, manual and
> automated execution, AI-assisted generation/review/analysis, public QA
> reports, and a community template library are implemented. See
> [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) and
> [docs/PHASE_STATUS.md](docs/PHASE_STATUS.md) for the current state.

## Stack

| Layer      | Choice                                                           |
| ---------- | ---------------------------------------------------------------- |
| Web app    | Next.js 16 (App Router) + React 19 + TypeScript (strict)         |
| Styling    | Tailwind CSS v4 + shadcn/ui (new-york theme tokens, `cn()` util) |
| Validation | zod v4 shared schemas in `packages/schemas`                      |
| Database   | Supabase (PostgreSQL) — migrations in `supabase/migrations`      |
| Test runs  | Playwright worker — `workers/playwright`                         |
| Quality    | ESLint (Next.js plugin) + Prettier + `tsc --noEmit` + Vitest     |

## Repository layout

```
app/                    Next.js App Router web app
components/ui/          shadcn/ui primitives (button included as setup proof)
lib/                    shared web-app utilities (cn())
packages/schemas/      shared zod schemas (via @schemas/* alias)
workers/playwright/    Playwright test-execution worker
supabase/migrations/   versioned database migrations
tests/                  vitest smoke tests
docs/                   project documentation
```

One `package.json` and one `package-lock.json` at the root — no duplicate
manifests or lockfiles by design.

## Setup

Prerequisites: Node.js ≥ 20.9 and npm.

```bash
git clone https://github.com/aliarslangujjar/TestPilot-AI.git
cd TestPilot-AI
npm install
cp .env.example .env.local   # fill in values locally; never commit them
npm run dev                  # http://localhost:3000
```

## Scripts

| Script                 | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `npm run dev`          | Start the local dev server                          |
| `npm run build`        | Production build                                    |
| `npm run start`        | Serve the production build                          |
| `npm run lint`         | ESLint check                                        |
| `npm run lint:fix`     | ESLint with auto-fix                                |
| `npm run format`       | Prettier write                                      |
| `npm run format:check` | Prettier check                                      |
| `npm run typecheck`    | TypeScript check (`tsc --noEmit`)                   |
| `npm run test`         | Vitest (single run)                                 |
| `npm run verify`       | Runs typecheck → lint → format:check → test → build |

A fresh clone should pass `npm run verify` end to end.

## Environment

`.env.example` lists every variable name the project expects — copy it to
`.env.local` and fill in values locally. Real secrets are never committed
(enforced by `.gitignore`).

## Deployment

The web app deploys to **Vercel** (git-connected: pushes to `main` are
production, PRs get previews) with a **Supabase** cloud project as the
data plane; the Playwright worker runs on a separate host. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the per-environment
variable matrix, the Supabase/Vercel setup runbook (migrations, auth
redirects, callbacks), the security checklist, health checks
(`/api/health`) and error reporting, and the current deployment
status.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, branching,
and pull-request guidance (including good-first-issue pointers) — the
short version:

- TypeScript strict mode; no `any` without justification.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:` …).
- Run `npm run verify` before opening a PR.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
Security issues: report privately — see [SECURITY.md](SECURITY.md),
never a public issue.

## License

MIT — see [LICENSE.md](LICENSE.md).
