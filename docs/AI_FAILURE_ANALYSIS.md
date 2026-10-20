# AI Failure Analysis

Advisory-only analysis of failed and timed-out automated run results.
Nothing here changes a run's outcome — a result is passed or failed by
the worker's evidence only (`docs/TEST_EXECUTION.md`).

## Inputs: bounded, sanitized evidence

`lib/ai-analysis/evidence.ts` builds one evidence bundle per result
(`packages/schemas/src/ai-analysis.ts` → `FailureEvidence`):

- failing step (action, index), plan locator, expected value
- actual: the step's sanitized error, else the job error
- browser error, console errors (≤5 × 300 chars), network errors
  (≤5 × 300 chars) — captured by the worker's driver during the run
- screenshot metadata (storage paths only, ≤5) — never image content
- execution status, attempts, worker `failure_kind`

Sanitization before anything is shown to a model (or the fallback):

- ANSI/control characters stripped
- secret-shaped values redacted (`password=…`, `Bearer …`,
  `api_key=…`, JWT shapes, `sk-…` keys) → `[redacted]`
- fill VALUES never included — only the locator is described
- every field capped; the whole bundle capped at ~7000 chars

## Outputs: hypotheses, never verdicts

`FailureAnalysis` returns `explanation`, `supportingEvidence`,
`probableClassification` (the name is the contract — never
"rootCause"), `confidence`, `uncertainty` (required), `debuggingSteps`,
and `fixSuggestions` where every suggestion carries an
`evidenceBasis` citing the evidence it relies on. The system prompt
(`lib/ai-analysis/prompt.ts`) hard-codes the same rules the schema
enforces: hypotheses only, evidence-cited fixes, explicit
uncertainty, no invented evidence.

## No-AI fallback

When no AI provider is configured (`getAIStatus().enabled === false`),
`analyzeRunFailure` uses the deterministic rule-based fallback
(`lib/ai-analysis/fallback.ts`): pattern matching on the sanitized
evidence, conservative confidence (≤ 0.6), and an uncertainty note
that states plainly it was rule-based, not a model, and not a
confirmed cause. `source` is persisted as `"fallback"` so it is never
mistaken for model output.

## Usage metering

AI-enabled analyses go through `generateStructured`, which enforces
the per-workspace daily request/token quotas and logs usage — the
same metering as test-plan generation. A provider failure returns a
typed `AIServiceError` and persists nothing; the caller may retry.
Fallback analyses are free and unmetered.

## Server actions (`lib/ai-analysis/actions.ts`)

| Action               | Notes                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `analyzeRunFailure`  | Membership → automated run → failed/timed-out result → linked job → evidence → AI or fallback → persists the envelope on the result |
| `getFailureAnalysis` | Returns the stored analysis, or null (also null for a corrupted stored envelope)                                                    |

Persistence: `run_results.failure_analysis` (jsonb envelope
`{ analysis, source, model, analyzedAt }`),
`failure_analysis_source` (`ai | fallback`), `failure_analyzed_at`
(migration `20261019160000_failure_analysis.sql`).

## Not yet built

- No UI surface: callers invoke the server actions. A run-detail
  "Analyze" button is the natural next step.
- Screenshots are metadata only — no vision analysis of captured
  screenshots yet.
- Evidence is per-result (the failing step); multi-step correlation
  across a run's results is not attempted.
