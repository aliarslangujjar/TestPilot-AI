import type {
  CaseDecision,
  GeneratedCase,
  ReviewFlag,
  ReviewSuggestion,
  SuggestionDecision,
} from "@schemas/ai-review";

/**
 * Review state machine — pure functions, no React.
 *
 * Rules:
 * - Approving a case requires every *blocker* flag to be resolved: either
 *   its suggestion was accepted, or the user explicitly acknowledged it.
 * - Warnings never block approval but stay visible.
 * - Editing a draft resets its decision to pending (an approval never
 *   silently survives a content change).
 * - Text suggestions carry the `from` value they were computed against and
 *   refuse to apply when the draft changed since (stale → no silent
 *   overwrite).
 */

export interface ReviewState {
  drafts: GeneratedCase[];
  flags: ReviewFlag[];
  suggestions: ReviewSuggestion[];
  suggestionDecisions: Record<string, SuggestionDecision>;
  caseDecisions: Record<string, CaseDecision>;
  acknowledgedFlags: string[];
  droppedTempIds: string[];
}

export function emptyReviewState(): Omit<ReviewState, "drafts" | "flags" | "suggestions"> {
  return {
    suggestionDecisions: {},
    caseDecisions: {},
    acknowledgedFlags: [],
    droppedTempIds: [],
  };
}

export function isFlagResolved(state: ReviewState, flag: ReviewFlag): boolean {
  if (state.acknowledgedFlags.includes(flag.id)) return true;
  if (flag.suggestionId && state.suggestionDecisions[flag.suggestionId] === "accepted") {
    return true;
  }
  return false;
}

export function unresolvedBlockers(state: ReviewState, tempId: string): ReviewFlag[] {
  return state.flags.filter(
    (f) => f.tempId === tempId && f.severity === "blocker" && !isFlagResolved(state, f),
  );
}

export function canApprove(state: ReviewState, tempId: string): boolean {
  if (state.droppedTempIds.includes(tempId)) return false;
  return unresolvedBlockers(state, tempId).length === 0;
}

export function setCaseDecision(
  state: ReviewState,
  tempId: string,
  decision: CaseDecision,
): { state: ReviewState; ok: boolean; reason?: string } {
  if (decision === "approved" && !canApprove(state, tempId)) {
    return { state, ok: false, reason: "unresolved-blockers" };
  }
  return {
    state: { ...state, caseDecisions: { ...state.caseDecisions, [tempId]: decision } },
    ok: true,
  };
}

export function acknowledgeFlag(state: ReviewState, flagId: string): ReviewState {
  if (state.acknowledgedFlags.includes(flagId)) return state;
  return { ...state, acknowledgedFlags: [...state.acknowledgedFlags, flagId] };
}

export function rejectSuggestion(state: ReviewState, suggestionId: string): ReviewState {
  if (state.suggestionDecisions[suggestionId] !== "pending") return state;
  return {
    ...state,
    suggestionDecisions: { ...state.suggestionDecisions, [suggestionId]: "rejected" },
  };
}

export type ApplyResult =
  | { state: ReviewState; applied: true }
  | { state: ReviewState; applied: false; reason: "not-pending" | "stale" | "draft-missing" };

/** Accept a suggestion and apply its change. Never overwrites edited text. */
export function applySuggestion(state: ReviewState, suggestionId: string): ApplyResult {
  const suggestion = state.suggestions.find((s) => s.id === suggestionId);
  if (!suggestion || (state.suggestionDecisions[suggestionId] ?? "pending") !== "pending") {
    return { state, applied: false, reason: "not-pending" };
  }
  const change = suggestion.change;
  let { drafts, droppedTempIds, caseDecisions } = state;

  if (change.kind === "set_field" || change.kind === "set_step_expected") {
    const index = drafts.findIndex((d) => d.tempId === suggestion.tempId);
    if (index === -1) return { state, applied: false, reason: "draft-missing" };
    const draft = drafts[index]!;
    const current =
      change.kind === "set_field" ? draft[change.field] : draft.steps[change.stepIndex]?.expected;
    if (current === undefined) return { state, applied: false, reason: "draft-missing" };
    // Staleness guard: refuse when the draft changed since the suggestion.
    if (current !== change.from) return { state, applied: false, reason: "stale" };
    const next =
      change.kind === "set_field"
        ? { ...draft, [change.field]: change.to }
        : {
            ...draft,
            steps: draft.steps.map((s, i) =>
              i === change.stepIndex ? { ...s, expected: change.to } : s,
            ),
          };
    drafts = drafts.map((d, i) => (i === index ? next : d));
  } else if (change.kind === "add_case") {
    if (!drafts.some((d) => d.tempId === change.draft.tempId)) {
      drafts = [...drafts, change.draft];
    }
  } else if (change.kind === "drop_duplicate") {
    if (suggestion.tempId) {
      droppedTempIds = [...droppedTempIds, suggestion.tempId];
      caseDecisions = { ...caseDecisions, [suggestion.tempId]: "rejected" };
    }
  }
  // "guidance": accepting marks the flag resolved; the user does the work.

  return {
    state: {
      ...state,
      drafts,
      droppedTempIds,
      caseDecisions,
      suggestionDecisions: { ...state.suggestionDecisions, [suggestionId]: "accepted" },
    },
    applied: true,
  };
}

/**
 * Edit a draft. Any edit resets that case's decision to pending — an
 * approval never silently survives a content change.
 */
export function editDraft(
  state: ReviewState,
  tempId: string,
  patch: Partial<Omit<GeneratedCase, "tempId">>,
): ReviewState {
  const drafts = state.drafts.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d));
  if (drafts.every((d, i) => d === state.drafts[i])) return state;
  return {
    ...state,
    drafts,
    caseDecisions: { ...state.caseDecisions, [tempId]: "pending" },
  };
}

/** Re-run analysis after edits; decisions keyed by surviving flag ids persist. */
export function reanalyze(
  state: ReviewState,
  flags: ReviewFlag[],
  suggestions: ReviewSuggestion[],
): ReviewState {
  const live = new Set(flags.map((f) => f.id));
  const liveSuggestions = new Set(suggestions.map((s) => s.id));
  const suggestionDecisions = Object.fromEntries(
    Object.entries(state.suggestionDecisions).filter(([id]) => liveSuggestions.has(id)),
  );
  return {
    ...state,
    flags,
    suggestions,
    suggestionDecisions,
    acknowledgedFlags: state.acknowledgedFlags.filter((id) => live.has(id)),
  };
}

export function approvedDrafts(state: ReviewState): GeneratedCase[] {
  return state.drafts.filter(
    (d) => state.caseDecisions[d.tempId] === "approved" && !state.droppedTempIds.includes(d.tempId),
  );
}
