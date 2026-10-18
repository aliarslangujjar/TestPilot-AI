# TestPilot AI

Open-source AI-powered QA SaaS.

> **Status:** project scaffold only. The repository structure, tooling, and
> documentation are in place — **no product features have been implemented
> yet**. See [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) for the
> architecture direction and current status.

## Stack

| Layer      | Choice                                                              |
| ---------- | ------------------------------------------------------------------- |
| Web app    | Next.js 16 (App Router) + React 19 + TypeScript (strict)            |
| Styling    | Tailwind CSS v4 + shadcn/ui (new-york theme tokens, `cn()` util)    |
| Validation | zod v4 shared schemas in `packages/schemas`                         |
| Database   | Supabase (PostgreSQL) — migrations in `supabase/migrations`         |
| Test runs  | Playwright worker — `workers/playwright` (planned, not implemented) |
| Quality    | ESLint (Next.js plugin) + Prettier + `tsc --noEmit` + Vitest        |

## Repository layout

```
app/                    Next.js App Router web app
components/ui/          shadcn/ui primitives (button included as setup proof)
lib/                    shared web-app utilities (cn())
packages/schemas/      shared zod schemas (via @schemas/* alias)
workers/playwright/    future test-execution worker (README only for now)
supabase/migrations/   database migrations (none yet)
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

## Contributing

- TypeScript strict mode; no `any` without justification.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:` …).
- Run `npm run verify` before opening a PR.

## License

MIT — see [LICENSE.md](LICENSE.md).
