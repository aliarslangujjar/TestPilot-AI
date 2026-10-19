# TestPilot AI — Analytics

The `/dashboard` page is an **analytics dashboard** computed entirely from
real workspace data. There is no sample data anywhere in it.

## Metrics

All aggregates come from `run_results`, `test_runs`, `test_cases`, and
`suites`, scoped to the workspace:

- **Total runs** — all `test_runs` in the workspace.
- **Test cases** / **Test suites** — active (non-archived) counts.
- **Executions** — `run_results` with an outcome other than `unexecuted`
  inside the selected range.
- **Global pass rate** — pass / all executed outcomes in the range. When
  there are no executions it shows `—`, never a fabricated number.
- **Draft cases** — active cases still in `draft` status (not ready to run).

## Charts

- **Pass rate by day** — daily pass % over the selected range (7/15/30
  days). Days with no executions break the line; they are never plotted as
  0%.
- **Results by day** — stacked daily bars for passed / failed / blocked /
  skipped.

Both charts are hand-rolled SVG (no chart library) with an accessible
`<details>` data-table fallback.

## Theme

Light/dark theme toggle (sun/moon) in the dashboard top bar and on the
landing page header. The choice persists in `localStorage`
(`testpilot-theme`); on first visit the OS `prefers-color-scheme` is used.
A blocking inline script in `app/layout.tsx` sets the initial `dark` class
before first paint so there is no flash. Tokens come from the existing
shadcn new-york variables in `app/globals.css` (`@custom-variant dark`).

## What's deliberately missing

The reference mockup had "Total Variants", "Avg Launch Rate", "Flaky
Tests", "Export PDF", and "Sync Now". None of those exist as honest,
computable quantities yet — they were left out rather than faked. Flaky
detection and PDF export are natural future additions.
