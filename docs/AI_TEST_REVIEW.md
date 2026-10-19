# TestPilot AI — AI Test-Case Review

Generated test cases are **never saved or counted as coverage** until a
human reviews, edits, and approves them. The review gate lives in
`lib/ai-review/` (schemas in `packages/schemas/src/ai-review.ts`) and the
`ReviewWorkspace` component (`components/ai-review/review-workspace.tsx`),
which the future generation step will feed with a batch of drafts.

## Workflow

1. **Analyze** — `analyzeGeneratedCases(drafts, existingCases)` runs
   deterministic heuristics (no AI) and returns flags + suggestions.
2. **Review** — the user edits drafts, accepts/rejects each suggestion
   (presented separately from the cases), and approves or rejects per case.
3. **Save** — `saveReviewedCases()` persists only approved cases, forced to
   `status: "draft"`, with content exactly as approved.

## Flag categories

| Category                     | Severity | Meaning                                                      |
| ---------------------------- | -------- | ------------------------------------------------------------ |
| `ambiguous_expected`         | warning  | Expected result states no observable outcome                 |
| `duplicate`                  | blocker  | Same normalized title as an existing case or a sibling draft |
| `unsupported_assumption`     | warning  | Hedging ("assuming…", "probably…") invented by the generator |
| `missing_coverage`           | warning  | Batch-level: no negative or no boundary cases                |
| `unsupported_browser_action` | blocker  | Step needs devtools/DOM access a manual tester can't do      |

**Blockers** must be resolved before a case can be approved: accept the
linked suggestion or explicitly acknowledge the flag. Warnings never block
but stay visible.

## Suggestions

Each flag carries one concrete suggestion, shown in a separate Suggestions
panel:

- `set_field` / `set_step_expected` — text replacement. Carries the `from`
  value it was computed against; **refuses to apply when the draft changed
  since** (stale → no silent overwrite).
- `add_case` — appends a negative/boundary template draft to the batch for
  review.
- `drop_duplicate` — marks the draft rejected as a duplicate.
- `guidance` — a verification task for the human (e.g. confirm an
  assumption against the requirements); accepting marks the flag resolved.

## Honesty rules (enforced, not just documented)

- **Never silently modify approved cases.** `editDraft()` resets a case's
  decision to pending on any edit — an approval never survives a content
  change. The save action persists the approved content untouched (the only
  transformation is the forced `draft` status, which is declared).
- **Never equate generated cases with completed coverage.** Approved cases
  are saved as drafts only; the UI states they "count as coverage only
  after a human executes them". Analytics counts executed results, so
  drafts can never inflate pass rates.

## Testing

- `tests/ai-review/analyze.test.ts` — every flag category fires (and
  doesn't fire) on the right inputs.
- `tests/ai-review/review-state.test.ts` — suggestion application incl.
  the staleness guard, blocker gating, acknowledge flow, edit-resets-approval,
  decision pruning on re-analysis.
- `tests/ai-review/review-workspace.test.tsx` — accept/reject/edit/approve
  interactions and exact-content save.
- `tests/ai-review/actions.test.ts` — membership denial, suite scoping,
  approved-only saving with forced draft status.
