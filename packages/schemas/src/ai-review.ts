import { z } from "zod";

/**
 * Review gate for AI-generated test cases. Generated drafts are never saved
 * or counted as coverage until a human reviews, edits, and approves them.
 */

export const generatedStepSchema = z.object({
  action: z.string().trim().min(1).max(500),
  expected: z.string().trim().min(1).max(500),
});

/** A generated test-case draft awaiting human review. */
export const generatedCaseSchema = z.object({
  tempId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(""),
  preconditions: z.string().trim().max(2000).default(""),
  steps: z.array(generatedStepSchema).min(1).max(50),
  expectedResults: z.string().trim().min(1).max(2000),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  /** Carried through review into the saved test case. */
  objective: z.string().trim().max(500).default(""),
  coverage: z.enum(["positive", "negative", "boundary"]).nullable().default(null),
  assumptions: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

export type GeneratedCase = z.infer<typeof generatedCaseSchema>;

export const reviewFlagCategorySchema = z.enum([
  "ambiguous_expected",
  "duplicate",
  "unsupported_assumption",
  "missing_coverage",
  "unsupported_browser_action",
]);

export type ReviewFlagCategory = z.infer<typeof reviewFlagCategorySchema>;

export const reviewFlagSchema = z.object({
  /** Deterministic: `${tempId ?? "batch"}:${category}:${index}`. */
  id: z.string().min(1),
  /** Null for batch-level flags (missing coverage). */
  tempId: z.string().uuid().nullable(),
  category: reviewFlagCategorySchema,
  severity: z.enum(["warning", "blocker"]),
  message: z.string().min(1),
  detail: z.string().optional(),
  suggestionId: z.string().optional(),
});

export type ReviewFlag = z.infer<typeof reviewFlagSchema>;

/**
 * A suggested change. Text replacements carry the `from` value they were
 * computed against: applying is refused when the draft changed since
 * (stale suggestion), so nothing is ever silently overwritten.
 */
export const suggestionChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set_field"),
    field: z.enum(["title", "description", "preconditions", "expectedResults"]),
    from: z.string(),
    to: z.string().min(1),
  }),
  z.object({
    kind: z.literal("set_step_expected"),
    stepIndex: z.number().int().min(0),
    from: z.string(),
    to: z.string().min(1),
  }),
  z.object({ kind: z.literal("add_case"), draft: generatedCaseSchema }),
  z.object({ kind: z.literal("drop_duplicate") }),
  z.object({ kind: z.literal("guidance"), text: z.string().min(1) }),
]);

export type SuggestionChange = z.infer<typeof suggestionChangeSchema>;

export const reviewSuggestionSchema = z.object({
  id: z.string().min(1),
  /** Null for batch-level suggestions. */
  tempId: z.string().uuid().nullable(),
  flagId: z.string().min(1),
  label: z.string().min(1),
  change: suggestionChangeSchema,
});

export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>;

export const caseDecisionSchema = z.enum(["pending", "approved", "rejected"]);
export type CaseDecision = z.infer<typeof caseDecisionSchema>;

export const suggestionDecisionSchema = z.enum(["pending", "accepted", "rejected"]);
export type SuggestionDecision = z.infer<typeof suggestionDecisionSchema>;

/** What the user submits for saving: drafts plus their explicit decisions. */
export const reviewSubmissionSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  suiteId: z.string().uuid(),
  cases: z.array(generatedCaseSchema).min(1).max(50),
  approvedTempIds: z.array(z.string().uuid()).min(1).max(50),
});

export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

export const REVIEW_FLAG_LABELS: Record<ReviewFlagCategory, string> = {
  ambiguous_expected: "Ambiguous expected result",
  duplicate: "Possible duplicate",
  unsupported_assumption: "Unsupported assumption",
  missing_coverage: "Missing negative/boundary cases",
  unsupported_browser_action: "Unsupported browser action",
};
