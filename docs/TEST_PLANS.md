# Stored Test Plans (template-guided generation)

`/dashboard/projects/[projectId]/plans` (linked as **Plans** from the
projects list). This is the stored counterpart of the quick
"Generate with AI" dialog:

- **Generate with AI** (test-case panel) — one-off drafts straight into the
  human review gate; nothing is stored.
- **Stored plans** (this page) — a plan is generated from a requirement, a
  user story, or acceptance criteria, **persisted**, and later **converted**
  into a suite of draft test cases.

## Templates

Six templates for common app types live in `lib/test-plans/templates.ts`:

| Key               | For                               | Default types                                 |
| ----------------- | --------------------------------- | --------------------------------------------- |
| `general-web-app` | Pages, forms, navigation          | functional, negative, boundary                |
| `ecommerce`       | Catalog, cart, checkout, payments | functional, negative, boundary, security      |
| `saas-dashboard`  | Widgets, reports, roles, settings | functional, negative, boundary, accessibility |
| `auth`            | Sign up/in, reset, sessions, MFA  | functional, negative, boundary, security      |
| `rest-api`        | Endpoints, contracts, auth        | functional, negative, boundary, security      |
| `content-site`    | Publishing, media, search         | functional, boundary, accessibility           |

Each template seeds default coverage areas and carries app-specific prompt
guidance (e.g. e-commerce payments cases describe observable UI/order state,
never a verified real charge; REST API cases are manual REST-client tests,
never load tests).

## Interactive controls

In the "New test plan" form the user controls generation:

- **Test types** — checkboxes (functional, negative, boundary, security,
  accessibility, performance); template defaults are pre-checked.
- **Coverage areas** — template defaults shown as removable chips; custom
  areas can be added (max 10).
- **Priorities** — strategy select: risk-first, balanced, or
  happy-path-first.
- **Max cases** (1–30) and a pre-generation token/cost estimate.

Post-validation guarantees the controls are honored: a provider response
missing any requested test type (or exceeding the cap) is rejected as
`AI_INVALID_RESPONSE` and **nothing is stored**. When AI is disabled, the
typed error reaches the UI and nothing is stored either.

## Storage

Migration `20261019170000_test_plans.sql` creates `public.test_plans`
(name, template_key, source_kind, source_text, settings jsonb, plan jsonb,
model, status `draft|converted`, suite_id) with workspace-member RLS.
Settings are stored with the plan, so any plan can be explained or
regenerated with the same inputs.

## Conversion

`convertTestPlan` creates a suite (named by the user) and inserts every
plan case as a **draft** test case carrying its title, steps, expected
results, priority, objective, coverage, assumptions, and tags
(test type, coverage area, coverage class). If case insertion fails, the
new suite is deleted again — no half-empty suites. Converting is one-way:
an already-converted plan refuses a second conversion, so plans never
duplicate suites.

**Boundary:** a stored or converted plan is planning material. Converted
cases are drafts; they are never presented as executed tests or achieved
coverage.
