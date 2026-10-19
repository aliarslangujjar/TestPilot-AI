# TestPilot AI — AI Test-Plan Generation

Generate manual test-case drafts from a **user story**, **acceptance
criteria**, or **testing request**. Generation is AI-assisted; activation
is human-gated. Nothing generated is ever claimed as executed.

## Flow

1. **Request** — in a test suite, click **Generate with AI**. Pick the
   source type, paste the text (20–8000 chars), set the max cases (1–20),
   and toggle negative/boundary coverage.
2. **Estimate** — before you generate, the dialog shows an approximate
   token count and cost for the configured provider/model. Estimates are
   heuristic (~4 chars per token); the actual usage is reported after the
   call.
3. **Generate** — the server action validates the request, confirms
   workspace membership, checks AI availability and quota, then calls the
   provider with a strictly-typed output schema (see below). Loading state
   is shown; errors are typed (`AI_DISABLED`, `AI_NOT_CONFIGURED`,
   `AI_QUOTA_EXCEEDED`, `AI_TIMEOUT`, `AI_PROVIDER_ERROR`,
   `AI_INVALID_RESPONSE`, `AI_INPUT_TOO_LONG`) with a retry option.
4. **Review** — drafts land in the human review gate
   (`docs/AI_TEST_REVIEW.md`): flag, edit, accept/reject suggestions,
   approve per case.
5. **Save** — approved cases are saved **as drafts only**, with content
   exactly as approved. They become active coverage only after a human
   executes them.

The generation action itself persists nothing.

## Output schema

Each generated case carries:

- `title`, `objective` (one sentence: what the case verifies)
- `preconditions`, `steps` (ordered; every step has an action and its own
  expected result — rendered numbered in the UI), `expectedResults`
  (observable outcomes only; vague phrases are banned by the system prompt)
- `priority`, `coverage` (`positive` | `negative` | `boundary`)
- `assumptions` (anything the model assumed that wasn't stated — surfaced
  for verification, editable in review)

## Strict validation

- Request: source ≥ 20 chars, max 1–20 cases, zod-validated before any AI
  call. Non-members are denied before the provider is touched.
- Response: zod schema parse, plus post-checks — at least one case, no
  more than requested, and the requested negative/boundary classes must
  actually be present, otherwise the response is rejected as
  `AI_INVALID_RESPONSE`.

## Fields on test_cases

Migration `20261019130000_test_case_ai_fields.sql` adds `objective`
(nullable), `coverage` (nullable, CHECK-constrained), and `assumptions`
(`text[]`, default empty). Manual cases can use them too — they're
optional fields in the case form and shown in the case detail view.

## Costs

Low-cost defaults (`gpt-4o-mini` / `claude-3-5-haiku-20241022`); a typical
8-case plan costs a fraction of a cent (OpenAI) to ~a cent (Anthropic).
Per-workspace daily quotas from `docs/AI_INTEGRATION.md` apply.

## Testing

- `tests/test-plans/schemas.test.ts` — request/case/plan validation.
- `tests/test-plans/prompt.test.ts` — prompt construction, coverage
  toggles, usage estimates.
- `tests/test-plans/actions.test.ts` — mocked `generateStructured`:
  draft mapping, strict-validation rejections, membership denial,
  error-code passthrough. No network, no paid calls.
- `tests/test-plans/generate-plan-dialog.test.tsx` — AI-disabled notice,
  estimate display, loading state, retryable errors, review handoff,
  save → close.
