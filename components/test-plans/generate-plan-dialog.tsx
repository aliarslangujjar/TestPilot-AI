"use client";

import { useEffect, useMemo, useState } from "react";

import { ReviewWorkspace } from "@/components/ai-review/review-workspace";
import { Dialog } from "@/components/projects/dialog";
import type { ExistingCaseRef } from "@/lib/ai-review/analyze";
import type { AIErrorCode } from "@/lib/ai/errors";
import { getAIStatus, type AIStatus } from "@/lib/ai/service";
import { generateTestPlan, type GeneratedTestPlan } from "@/lib/test-plans/actions";
import { estimateTestPlanUsage } from "@/lib/test-plans/prompt";
import { TEST_PLAN_SOURCE_LABELS, type TestPlanSourceKind } from "@schemas/test-plan";

const ERROR_HELP: Record<AIErrorCode, string> = {
  AI_DISABLED:
    "AI is not enabled — set OPENAI_API_KEY or ANTHROPIC_API_KEY in the server environment.",
  AI_NOT_CONFIGURED: "AI is not configured correctly. Check the server environment variables.",
  AI_QUOTA_EXCEEDED: "This workspace has used its daily AI allowance. Try again tomorrow.",
  AI_TIMEOUT: "The request timed out. Try again, or shorten the source text.",
  AI_PROVIDER_ERROR: "The AI provider returned an error. Try again in a moment.",
  AI_INVALID_RESPONSE: "The AI returned an unusable plan. Try again or rephrase the source.",
  AI_INPUT_TOO_LONG: "The source text is too long. Shorten it and try again.",
};

const SOURCE_KINDS: TestPlanSourceKind[] = ["user_story", "acceptance_criteria", "testing_request"];

function formatUsd(n: number): string {
  return n < 0.01 ? `<$0.01` : `$${n.toFixed(2)}`;
}

/**
 * AI test-plan generation dialog: form → loading → human review.
 *
 * Generated drafts are never saved automatically and never claimed as
 * executed — they land in the ReviewWorkspace, and only approved cases are
 * saved, as drafts.
 */
export function GeneratePlanDialog({
  workspaceId,
  projectId,
  suiteId,
  existingCases,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  projectId: string;
  suiteId: string;
  existingCases: ExistingCaseRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sourceKind, setSourceKind] = useState<TestPlanSourceKind>("user_story");
  const [sourceText, setSourceText] = useState("");
  const [maxCases, setMaxCases] = useState(8);
  const [includeNegative, setIncludeNegative] = useState(true);
  const [includeBoundary, setIncludeBoundary] = useState(true);
  const [phase, setPhase] = useState<"form" | "loading" | "review">("form");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AIErrorCode | null>(null);
  const [plan, setPlan] = useState<GeneratedTestPlan | null>(null);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    getAIStatus()
      .then(setAiStatus)
      .catch(() => setStatusError(true));
  }, []);

  const estimate = useMemo(
    () =>
      aiStatus && sourceText.trim().length >= 20
        ? estimateTestPlanUsage(sourceText, maxCases, aiStatus.provider)
        : null,
    [aiStatus, sourceText, maxCases],
  );

  async function handleGenerate() {
    if (sourceText.trim().length < 20 || phase === "loading") return;
    setPhase("loading");
    setError(null);
    setErrorCode(null);
    const result = await generateTestPlan({
      workspaceId,
      sourceKind,
      sourceText: sourceText.trim(),
      maxCases,
      includeNegative,
      includeBoundary,
    });
    if (!result.ok) {
      setPhase("form");
      setError(result.error);
      setErrorCode(result.code ?? null);
      return;
    }
    setPlan(result.data);
    setPhase("review");
  }

  if (phase === "review" && plan) {
    return (
      <div
        className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="mx-auto max-w-5xl rounded-lg border bg-background p-6 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Review generated test plan</h2>
            <button
              type="button"
              onClick={() => setPhase("form")}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Back to generator
            </button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Generated {plan.cases.length} case{plan.cases.length === 1 ? "" : "s"} with {plan.model}{" "}
            · used ~{plan.usage.inputTokens + plan.usage.outputTokens} tokens · nothing here has
            executed.
          </p>
          {plan.summary && (
            <p className="mt-2 rounded-md border bg-card p-3 text-sm">{plan.summary}</p>
          )}
          <div className="mt-4">
            <ReviewWorkspace
              workspaceId={workspaceId}
              projectId={projectId}
              suiteId={suiteId}
              initialDrafts={plan.cases}
              existingCases={existingCases}
              onSaved={() => {
                onSaved();
                onClose();
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog
      title="Generate test plan with AI"
      labelledBy="generate-plan-title"
      onClose={onClose}
      wide
    >
      {statusError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not check the AI status. Please try again.
        </p>
      ) : !aiStatus ? (
        <p className="text-sm text-muted-foreground">Checking AI availability…</p>
      ) : !aiStatus.enabled ? (
        <div className="text-sm">
          <p role="alert" className="font-medium">
            AI is not enabled.
          </p>
          <p className="mt-1 text-muted-foreground">
            Set <code>OPENAI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> in the server
            environment to enable generation. See <code>docs/AI_INTEGRATION.md</code>.
          </p>
        </div>
      ) : phase === "loading" ? (
        <div className="py-8 text-center" role="status" aria-live="polite">
          <div
            aria-hidden="true"
            className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
          />
          <p className="mt-3 font-medium">Generating test plan…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This usually takes 10–30 seconds. The plan will need your review before anything is
            saved.
          </p>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleGenerate();
          }}
        >
          <div>
            <label htmlFor="plan-source-kind" className="text-sm font-medium">
              Source type
            </label>
            <select
              id="plan-source-kind"
              value={sourceKind}
              onChange={(e) => setSourceKind(e.target.value as TestPlanSourceKind)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TEST_PLAN_SOURCE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="plan-source-text" className="text-sm font-medium">
              {TEST_PLAN_SOURCE_LABELS[sourceKind]}
            </label>
            <textarea
              id="plan-source-text"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              rows={6}
              placeholder="As a shopper, I want to apply a discount code at checkout so that I pay the reduced price…"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {sourceText.trim().length} / 8000 characters (minimum 20)
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Max cases
              <input
                type="number"
                min={1}
                max={20}
                value={maxCases}
                onChange={(e) =>
                  setMaxCases(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                }
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeNegative}
                onChange={(e) => setIncludeNegative(e.target.checked)}
              />
              Negative cases
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeBoundary}
                onChange={(e) => setIncludeBoundary(e.target.checked)}
              />
              Boundary cases
            </label>
          </div>
          {estimate && (
            <p
              className="rounded-md border bg-card p-3 text-xs text-muted-foreground"
              role="status"
            >
              Estimated usage: ~{estimate.inputTokens + estimate.outputTokens} tokens (
              {formatUsd(estimate.costUsd)}) on {aiStatus.model}. Estimates are approximate.
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <p className="font-medium text-destructive">
                {(errorCode && ERROR_HELP[errorCode]) || error}
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                className="mt-1.5 text-xs underline-offset-4 hover:underline"
              >
                Try again
              </button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sourceText.trim().length < 20}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate plan
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Generated cases are drafts until you review and approve them — they are never claimed as
            executed.
          </p>
        </form>
      )}
    </Dialog>
  );
}
