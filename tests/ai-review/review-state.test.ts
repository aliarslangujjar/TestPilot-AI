/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { analyzeGeneratedCases } from "@/lib/ai-review/analyze";
import {
  acknowledgeFlag,
  applySuggestion,
  approvedDrafts,
  canApprove,
  editDraft,
  emptyReviewState,
  reanalyze,
  setCaseDecision,
  type ReviewState,
} from "@/lib/ai-review/review-state";
import type { GeneratedCase } from "@schemas/ai-review";

const TEMP_A = "11111111-1111-4111-8111-111111111111";
const TEMP_B = "22222222-2222-4222-8222-222222222222";

function draft(overrides: Partial<GeneratedCase> = {}): GeneratedCase {
  return {
    tempId: TEMP_A,
    title: "Login with valid credentials",
    description: "",
    preconditions: "",
    steps: [{ action: "Submit the form", expected: "The page loads successfully" }],
    expectedResults: "The user lands on the dashboard",
    priority: "medium",
    tags: [],
    ...overrides,
  };
}

function stateFor(
  drafts: GeneratedCase[],
  existing: { id: string; title: string }[] = [],
): ReviewState {
  const { flags, suggestions } = analyzeGeneratedCases(drafts, existing);
  return { drafts, flags, suggestions, ...emptyReviewState() };
}

describe("review-state", () => {
  it("applies a text suggestion only when the draft is unchanged", () => {
    const state = stateFor([draft()]);
    const suggestion = state.suggestions.find((s) => s.change.kind === "set_step_expected")!;
    const applied = applySuggestion(state, suggestion.id);
    expect(applied.applied).toBe(true);
    expect(applied.state.drafts[0]?.steps[0]?.expected).toContain("[TODO:");

    // Stale: the draft changed since the suggestion was made.
    const edited = editDraft(state, TEMP_A, {
      steps: [{ action: "Submit the form", expected: "Something else entirely" }],
    });
    const stale = applySuggestion(edited, suggestion.id);
    expect(stale.applied).toBe(false);
    if (!stale.applied) expect(stale.reason).toBe("stale");
  });

  it("drop_duplicate marks the draft rejected", () => {
    const state = stateFor([draft()], [{ id: "e1", title: "Login with valid credentials" }]);
    const suggestion = state.suggestions.find((s) => s.change.kind === "drop_duplicate")!;
    const result = applySuggestion(state, suggestion.id);
    expect(result.applied).toBe(true);
    expect(result.state.caseDecisions[TEMP_A]).toBe("rejected");
    expect(result.state.droppedTempIds).toContain(TEMP_A);
  });

  it("add_case appends a new draft to the batch", () => {
    const state = stateFor([draft()]);
    const suggestion = state.suggestions.find((s) => s.change.kind === "add_case")!;
    const result = applySuggestion(state, suggestion.id);
    expect(result.applied).toBe(true);
    expect(result.state.drafts).toHaveLength(2);
    expect(result.state.drafts[1]?.tempId).not.toBe(TEMP_A);
  });

  it("blocks approval until blockers are resolved", () => {
    const state = stateFor([draft()], [{ id: "e1", title: "Login with valid credentials" }]);
    expect(canApprove(state, TEMP_A)).toBe(false);
    expect(setCaseDecision(state, TEMP_A, "approved").ok).toBe(false);

    // Resolving via the suggestion unblocks.
    const suggestion = state.suggestions.find((s) => s.change.kind === "drop_duplicate")!;
    const resolved = applySuggestion(state, suggestion.id);
    expect(resolved.applied).toBe(true);
    // Dropped drafts can't be approved either.
    expect(canApprove(resolved.state, TEMP_A)).toBe(false);
  });

  it("acknowledging a blocker unblocks approval explicitly", () => {
    const state = stateFor([draft()], [{ id: "e1", title: "Login with valid credentials" }]);
    const blocker = state.flags.find((f) => f.severity === "blocker")!;
    const acked = acknowledgeFlag(state, blocker.id);
    expect(canApprove(acked, TEMP_A)).toBe(true);
    expect(setCaseDecision(acked, TEMP_A, "approved").ok).toBe(true);
  });

  it("editing an approved draft resets it to pending", () => {
    let state = stateFor([draft({ expectedResults: "Dashboard shows the username" })]);
    // No blockers (ambiguous text removed) — but batch still lacks negative/boundary,
    // which are warnings, so approval is allowed.
    const approved = setCaseDecision(state, TEMP_A, "approved");
    expect(approved.ok).toBe(true);
    state = editDraft(approved.state, TEMP_A, { title: "Login with valid credentials v2" });
    expect(state.caseDecisions[TEMP_A]).toBe("pending");
  });

  it("reanalyze drops decisions for flags that disappeared", () => {
    const before = stateFor([draft()]);
    const flagId = before.flags.find((f) => f.category === "ambiguous_expected")!.id;
    const acked = acknowledgeFlag(before, flagId);
    // Edit removes the vague phrase; re-run analysis.
    const edited = editDraft(acked, TEMP_A, {
      steps: [{ action: "Submit the form", expected: "Dashboard shows the username" }],
    });
    const { flags, suggestions } = analyzeGeneratedCases(edited.drafts, []);
    const next = reanalyze(edited, flags, suggestions);
    expect(next.flags.some((f) => f.id === flagId)).toBe(false);
    expect(next.acknowledgedFlags).not.toContain(flagId);
  });

  it("approvedDrafts returns exactly the approved, non-dropped drafts", () => {
    const first = draft();
    const second = draft({ tempId: TEMP_B, title: "Logout ends the session" });
    let state = stateFor([first, second]);
    state = setCaseDecision(state, TEMP_A, "approved").state;
    // TEMP_B has an ambiguous step expected? No — "Logout ends the session"
    // title is fine; steps still vague ("The page loads successfully")... it
    // only has warnings, so approval is allowed.
    const secondApproved = setCaseDecision(state, TEMP_B, "approved");
    expect(secondApproved.ok).toBe(true);
    expect(approvedDrafts(secondApproved.state).map((d) => d.tempId)).toEqual([TEMP_A, TEMP_B]);
  });
});
