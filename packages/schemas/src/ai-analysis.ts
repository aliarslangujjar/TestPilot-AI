import { z } from "zod";

/**
 * AI failure analysis for failed/timed-out automated runs.
 *
 * Honesty rules are baked into the type names on purpose:
 * - `probableClassification` — never "rootCause". Hypotheses, not verdicts.
 * - every fix suggestion carries `evidenceBasis` — the exact evidence it
 *   rests on. A suggestion without cited evidence is a schema violation.
 * - `uncertainty` is required: what could not be determined must be
 *   stated, not implied.
 */

/** Bounded, sanitized evidence bundle for one failed/timed-out result. */
export const failureEvidenceSchema = z.object({
  caseTitle: z.string().max(200),
  executionStatus: z.enum(["failed", "timed_out"]),
  failingStepIndex: z.number().int().nullable(),
  failingAction: z.string().max(50).nullable(),
  /** Human-readable description of the step's target, e.g. 'role button "Sign in"'. */
  locator: z.string().max(300).nullable(),
  /** What the test expected (plan assertion / step expectation). */
  expected: z.string().max(1000).nullable(),
  /** What was observed: the step's sanitized error, or the job error. */
  actual: z.string().max(1000).nullable(),
  browserError: z.string().max(1000).nullable(),
  consoleErrors: z.array(z.string().max(300)).max(5),
  networkErrors: z.array(z.string().max(300)).max(5),
  /** Screenshot metadata: storage paths only, never content. */
  artifacts: z.array(z.string().max(500)).max(5),
  attempts: z.number().int(),
  failureKind: z.enum(["assertion", "infra", "timeout"]).nullable(),
});

export type FailureEvidence = z.infer<typeof failureEvidenceSchema>;

export const probableFailureClassificationSchema = z.enum([
  "locator_issue",
  "assertion_mismatch",
  "timing_or_flake",
  "application_error",
  "network_issue",
  "environment_issue",
  "test_data_issue",
  "unknown",
]);

export type ProbableFailureClassification = z.infer<typeof probableFailureClassificationSchema>;

export const fixSuggestionSchema = z.object({
  suggestion: z.string().min(1).max(500),
  /** The exact evidence this suggestion relies on. Required by schema. */
  evidenceBasis: z.string().min(1).max(500),
});

export type FixSuggestion = z.infer<typeof fixSuggestionSchema>;

export const failureAnalysisSchema = z.object({
  explanation: z.string().min(1).max(2000),
  supportingEvidence: z.array(z.string().max(500)).min(1).max(8),
  probableClassification: probableFailureClassificationSchema,
  confidence: z.number().min(0).max(1),
  uncertainty: z.string().min(1).max(1000),
  debuggingSteps: z.array(z.string().max(500)).min(1).max(6),
  fixSuggestions: z.array(fixSuggestionSchema).max(5),
});

export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;

export const failureAnalysisSourceSchema = z.enum(["ai", "fallback"]);

export type FailureAnalysisSource = z.infer<typeof failureAnalysisSourceSchema>;
