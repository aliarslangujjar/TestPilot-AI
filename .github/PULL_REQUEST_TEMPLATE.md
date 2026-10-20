<!--
Thanks for the PR! Fill in each section — an honest checklist makes
review faster. See CONTRIBUTING.md for setup and conventions.
-->

## Summary

<!-- What does this change, and why? One or two short paragraphs. -->

## Linked issue

<!-- e.g. Closes #123. For non-trivial work an issue should exist first. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal change
- [ ] Documentation
- [ ] Tests only
- [ ] Database migration

## Checklist

- [ ] `npm run verify` passes locally (typecheck → lint → format → test → build). Paste the result summary if anything was unusual.
- [ ] New or changed behavior is covered by tests, and bug fixes include a regression test.
- [ ] No secrets, credentials, or `.env` values are committed; no personal data in test fixtures.
- [ ] Input is validated with the shared zod schemas where it crosses a boundary.
- [ ] Authorization is intact: no RLS disabled, no service-role key in client code, workspace scoping preserved.
- [ ] Docs updated where behavior changed (feature docs in `docs/`, README if applicable).

### Database changes (if any)

- [ ] New migration file added (applied migrations are never edited).
- Migration file: `…`
- Canary query a reviewer can run to confirm it applies: `…`
- [ ] New tables carry their own grants and RLS policies in the same migration.

### UI changes (if any)

- [ ] Screenshots (before / after) attached below.
- [ ] Copy does not present planned or mock behavior as implemented.

## Screenshots / notes

<!-- Anything reviewers should know: trade-offs, follow-ups, open questions. -->
