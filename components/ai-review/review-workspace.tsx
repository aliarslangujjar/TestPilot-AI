"use client";

import { useState } from "react";

import { analyzeGeneratedCases, type ExistingCaseRef } from "@/lib/ai-review/analyze";
import { saveReviewedCases } from "@/lib/ai-review/actions";
import {
  acknowledgeFlag,
  applySuggestion,
  approvedDrafts,
  canApprove,
  editDraft,
  emptyReviewState,
  isFlagResolved,
  rejectSuggestion,
  reanalyze,
  setCaseDecision,
  unresolvedBlockers,
  type ReviewState,
} from "@/lib/ai-review/review-state";
import { REVIEW_FLAG_LABELS, type CaseDecision, type GeneratedCase } from "@schemas/ai-review";
import { cn } from "@/lib/utils";

function initialState(drafts: GeneratedCase[], existingCases: ExistingCaseRef[]): ReviewState {
  const { flags, suggestions } = analyzeGeneratedCases(drafts, existingCases);
  return { drafts, flags, suggestions, ...emptyReviewState() };
}

function DecisionBadge({ decision }: { decision: CaseDecision }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        decision === "approved" &&
          "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
        decision === "rejected" && "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
        decision === "pending" && "bg-muted text-muted-foreground",
      )}
    >
      {decision}
    </span>
  );
}

/**
 * Human review gate for AI-generated test cases.
 *
 * Generated drafts arrive via props (from the future generation step).
 * Flags and suggestions are presented separately; the user edits, accepts
 * or rejects suggestions, approves per case, and only then saves — approved
 * cases are stored as drafts, never as coverage.
 */
export function ReviewWorkspace({
  workspaceId,
  projectId,
  suiteId,
  initialDrafts,
  existingCases,
  onSaved,
}: {
  workspaceId: string;
  projectId: string;
  suiteId: string;
  initialDrafts: GeneratedCase[];
  existingCases: ExistingCaseRef[];
  /** Called after approved drafts are saved (e.g. to refresh a list). */
  onSaved?: (created: number) => void;
}) {
  const [review, setReview] = useState<ReviewState>(() =>
    initialState(initialDrafts, existingCases),
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialDrafts[0]?.tempId ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  /** Apply a state transition, re-running analysis when drafts changed. */
  function commit(next: ReviewState) {
    setReview((prev) => {
      if (next.drafts !== prev.drafts) {
        const { flags, suggestions } = analyzeGeneratedCases(next.drafts, existingCases);
        return reanalyze(next, flags, suggestions);
      }
      return next;
    });
  }

  const selected = review.drafts.find((d) => d.tempId === selectedId) ?? null;
  const selectedFlags = selected ? review.flags.filter((f) => f.tempId === selected.tempId) : [];
  const pendingSuggestions = review.suggestions.filter(
    (s) => (review.suggestionDecisions[s.id] ?? "pending") === "pending",
  );
  const approved = approvedDrafts(review);

  function onEdit(tempId: string, patch: Partial<Omit<GeneratedCase, "tempId">>) {
    setSaveError(null);
    commit(editDraft(review, tempId, patch));
  }

  function onAcceptSuggestion(id: string) {
    setApplyError(null);
    const result = applySuggestion(review, id);
    if (!result.applied) {
      setApplyError(
        result.reason === "stale"
          ? "That suggestion is stale — the draft changed since it was made. Review the text and decide manually."
          : "That suggestion could not be applied.",
      );
      return;
    }
    commit(result.state);
  }

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    const cases = approvedDrafts(review);
    const result = await saveReviewedCases({
      workspaceId,
      projectId,
      suiteId,
      cases,
      approvedTempIds: cases.map((c) => c.tempId),
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSavedCount(result.data.created);
    onSaved?.(result.data.created);
  }

  if (review.drafts.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="font-medium">No generated cases to review</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Generated drafts will appear here for human review before anything is saved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium">Review generated drafts</p>
        <p className="mt-1 text-muted-foreground">
          Nothing here is coverage. Edit freely, accept or reject each suggestion, approve per case
          — then save. Approved cases are stored as <strong>drafts only</strong>; they count as
          coverage only after a human executes them.
        </p>
      </div>

      {applyError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
        >
          {applyError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Draft list */}
        <nav aria-label="Generated drafts" className="space-y-2">
          {review.drafts.map((d) => {
            const blockers = unresolvedBlockers(review, d.tempId).length;
            const warnings = review.flags.filter(
              (f) =>
                f.tempId === d.tempId && f.severity === "warning" && !isFlagResolved(review, f),
            ).length;
            const decision = review.caseDecisions[d.tempId] ?? "pending";
            const dropped = review.droppedTempIds.includes(d.tempId);
            return (
              <button
                key={d.tempId}
                type="button"
                onClick={() => setSelectedId(d.tempId)}
                aria-current={selectedId === d.tempId ? "true" : undefined}
                className={cn(
                  "w-full rounded-lg border bg-card p-3 text-left",
                  selectedId === d.tempId && "border-primary ring-1 ring-primary",
                )}
              >
                <p className="truncate text-sm font-medium">{d.title}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <DecisionBadge decision={dropped ? "rejected" : decision} />
                  {blockers > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
                      {blockers} blocker{blockers === 1 ? "" : "s"}
                    </span>
                  )}
                  {warnings > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      {warnings} warning{warnings === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Editor + flags */}
        <div className="space-y-4">
          {selected ? (
            <>
              <section aria-label="Edit draft" className="rounded-lg border bg-card p-4 space-y-3">
                <h2 className="font-semibold">Edit draft</h2>
                <label className="block text-sm">
                  <span className="text-muted-foreground">Title</span>
                  <input
                    value={selected.title}
                    onChange={(e) => onEdit(selected.tempId, { title: e.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted-foreground">Objective</span>
                  <input
                    value={selected.objective ?? ""}
                    onChange={(e) => onEdit(selected.tempId, { objective: e.target.value })}
                    placeholder="What this case verifies"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <textarea
                    value={selected.description}
                    onChange={(e) => onEdit(selected.tempId, { description: e.target.value })}
                    rows={2}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted-foreground">Preconditions</span>
                  <textarea
                    value={selected.preconditions}
                    onChange={(e) => onEdit(selected.tempId, { preconditions: e.target.value })}
                    rows={2}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <div className="text-sm">
                  <p className="text-muted-foreground">Steps</p>
                  <ol className="mt-1 space-y-2">
                    {selected.steps.map((step, i) => (
                      <li key={i} className="rounded-md border p-2 space-y-2">
                        <label className="block">
                          <span className="text-xs text-muted-foreground">Action</span>
                          <input
                            value={step.action}
                            onChange={(e) =>
                              onEdit(selected.tempId, {
                                steps: selected.steps.map((s, j) =>
                                  j === i ? { ...s, action: e.target.value } : s,
                                ),
                              })
                            }
                            className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted-foreground">Expected</span>
                          <input
                            value={step.expected}
                            onChange={(e) =>
                              onEdit(selected.tempId, {
                                steps: selected.steps.map((s, j) =>
                                  j === i ? { ...s, expected: e.target.value } : s,
                                ),
                              })
                            }
                            className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            onEdit(selected.tempId, {
                              steps: selected.steps.filter((_, j) => j !== i),
                            })
                          }
                          className="text-xs text-destructive underline-offset-4 hover:underline"
                        >
                          Remove step
                        </button>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() =>
                      onEdit(selected.tempId, {
                        steps: [...selected.steps, { action: "", expected: "" }],
                      })
                    }
                    className="mt-2 text-sm text-primary underline-offset-4 hover:underline"
                  >
                    + Add step
                  </button>
                </div>
                <label className="block text-sm">
                  <span className="text-muted-foreground">Expected results</span>
                  <textarea
                    value={selected.expectedResults}
                    onChange={(e) => onEdit(selected.tempId, { expectedResults: e.target.value })}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <div className="flex gap-3">
                  <label className="block text-sm">
                    <span className="text-muted-foreground">Coverage</span>
                    <select
                      value={selected.coverage ?? ""}
                      onChange={(e) =>
                        onEdit(selected.tempId, {
                          coverage: (e.target.value || null) as GeneratedCase["coverage"],
                        })
                      }
                      className="mt-1 rounded-md border border-input bg-background px-2 py-2"
                    >
                      <option value="">—</option>
                      {["positive", "negative", "boundary"].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block flex-1 text-sm">
                    <span className="text-muted-foreground">Assumptions (one per line)</span>
                    <textarea
                      value={(selected.assumptions ?? []).join("\n")}
                      onChange={(e) =>
                        onEdit(selected.tempId, {
                          assumptions: e.target.value
                            .split("\n")
                            .map((a) => a.trim())
                            .filter(Boolean),
                        })
                      }
                      rows={2}
                      placeholder="Anything the generator assumed"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                </div>
                <div className="flex gap-3">
                  <label className="block text-sm">
                    <span className="text-muted-foreground">Priority</span>
                    <select
                      value={selected.priority}
                      onChange={(e) =>
                        onEdit(selected.tempId, {
                          priority: e.target.value as GeneratedCase["priority"],
                        })
                      }
                      className="mt-1 rounded-md border border-input bg-background px-2 py-2"
                    >
                      {["low", "medium", "high", "critical"].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block flex-1 text-sm">
                    <span className="text-muted-foreground">Tags (comma-separated)</span>
                    <input
                      value={selected.tags.join(", ")}
                      onChange={(e) =>
                        onEdit(selected.tempId, {
                          tags: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                </div>
              </section>

              <section aria-label="Review flags" className="rounded-lg border bg-card p-4">
                <h2 className="font-semibold">Flags</h2>
                {selectedFlags.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">No flags — looks clean.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {selectedFlags.map((flag) => {
                      const resolved = isFlagResolved(review, flag);
                      return (
                        <li key={flag.id} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                flag.severity === "blocker"
                                  ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
                              )}
                            >
                              {flag.severity}
                            </span>
                            <span className="font-medium">{REVIEW_FLAG_LABELS[flag.category]}</span>
                            {resolved && (
                              <span className="text-xs text-green-700 dark:text-green-300">
                                resolved
                              </span>
                            )}
                          </div>
                          <p className="mt-1">{flag.message}</p>
                          {flag.detail && (
                            <p className="mt-0.5 text-muted-foreground">{flag.detail}</p>
                          )}
                          {!resolved && (
                            <button
                              type="button"
                              onClick={() => commit(acknowledgeFlag(review, flag.id))}
                              className="mt-1.5 text-xs underline-offset-4 hover:underline"
                            >
                              Acknowledge as-is
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-2">
                {(() => {
                  const decision = review.caseDecisions[selected.tempId] ?? "pending";
                  const blockers = unresolvedBlockers(review, selected.tempId);
                  const approvable = canApprove(review, selected.tempId);
                  return (
                    <>
                      <button
                        type="button"
                        disabled={!approvable || decision === "approved"}
                        onClick={() => {
                          const r = setCaseDecision(review, selected.tempId, "approved");
                          if (r.ok) commit(r.state);
                        }}
                        title={
                          approvable
                            ? "Approve this draft"
                            : `Resolve ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} first`
                        }
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Approve
                      </button>
                      {!approvable && blockers.length > 0 && (
                        <p className="w-full text-xs text-muted-foreground">
                          Resolve {blockers.length} blocker{blockers.length === 1 ? "" : "s"} above
                          (accept its suggestion or acknowledge it) before approving.
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={decision === "rejected"}
                        onClick={() => {
                          const r = setCaseDecision(review, selected.tempId, "rejected");
                          if (r.ok) commit(r.state);
                        }}
                        className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Reject
                      </button>
                      {decision !== "pending" && (
                        <button
                          type="button"
                          onClick={() => {
                            const r = setCaseDecision(review, selected.tempId, "pending");
                            if (r.ok) commit(r.state);
                          }}
                          className="rounded-md px-2 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
                        >
                          Reset to pending
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a draft to review it.</p>
          )}
        </div>
      </div>

      {/* Suggestions — presented separately from the cases */}
      <section aria-label="Suggestions" className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Suggestions</h2>
        <p className="text-xs text-muted-foreground">
          Proposed fixes, one per flag. Accepting applies the change to the draft — nothing happens
          silently.
        </p>
        {pendingSuggestions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No pending suggestions.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pendingSuggestions.map((s) => {
              const flag = review.flags.find((f) => f.id === s.flagId);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{s.label}</p>
                    {flag && (
                      <p className="text-xs text-muted-foreground">
                        {REVIEW_FLAG_LABELS[flag.category]} · {flag.message}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onAcceptSuggestion(s.id)}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => commit(rejectSuggestion(review, s.id))}
                      className="rounded-md border px-3 py-1.5 text-xs font-medium"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Save bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <button
          type="button"
          disabled={approved.length === 0 || saving || savedCount !== null}
          onClick={onSave}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving
            ? "Saving…"
            : `Save ${approved.length} approved as draft${approved.length === 1 ? "" : "s"}`}
        </button>
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        )}
        {savedCount !== null && (
          <p role="status" className="text-sm text-green-700 dark:text-green-300">
            Saved {savedCount} case{savedCount === 1 ? "" : "s"} as drafts. They are not coverage
            until a human executes them.
          </p>
        )}
      </div>
    </div>
  );
}
