/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AutomatedRunDetail } from "@/components/test-runs/automated-run-detail";
import type { AutomatedRunDetail as Detail } from "@/lib/run-details/details";

vi.mock("@/lib/run-details/details", () => ({ getAutomatedRunDetail: vi.fn() }));
vi.mock("@/lib/run-details/artifacts", () => ({ getArtifactSignedUrl: vi.fn() }));
vi.mock("@/lib/run-details/compare", () => ({ compareAutomatedRuns: vi.fn() }));
vi.mock("@/lib/ai-analysis/actions", () => ({
  analyzeRunFailure: vi.fn(),
  parseStoredFailureAnalysis: vi.fn(),
}));
vi.mock("@/lib/test-runs/automated", () => ({ refreshAutomatedRun: vi.fn() }));

afterEach(() => cleanup());

const WS = "11111111-1111-4111-8111-111111111111";

const DETAIL: Detail = {
  runId: "55555555-5555-4555-8555-555555555555",
  name: "Nightly",
  status: "completed",
  executionStatus: "failed",
  createdAt: "2026-10-19T00:00:00.000Z",
  completedAt: "2026-10-19T00:01:00.000Z",
  durationMs: 60000,
  summary: { total: 2, passed: 1, failed: 1, timedOut: 0, cancelled: 0, queued: 0, running: 0 },
  results: [
    {
      resultId: "66666666-6666-4666-8666-666666666666",
      testCaseId: "33333333-3333-4333-8333-333333333333",
      caseTitle: "Submit flow",
      outcome: "fail",
      executionStatus: "failed",
      browserJobId: "88888888-8888-4888-8888-888888888888",
      attempts: 1,
      failureKind: "assertion",
      durationMs: 2000,
      steps: [
        { index: 0, action: "goto", ok: true, durationMs: 300, error: null },
        { index: 1, action: "click", ok: false, durationMs: 1500, error: "locator not found" },
      ],
      expected: 'role button "Submit" to be clickable',
      actual: "locator not found",
      logs: { consoleErrors: ["TypeError: boom"], networkErrors: [] },
      artifacts: [`${WS}/job/step-1.png`],
      analysis: {
        analysis: {
          explanation: "Hypothesis: the locator no longer matches.",
          supportingEvidence: ["Step 1 (click) failed: locator not found"],
          probableClassification: "locator_issue",
          confidence: 0.55,
          uncertainty: "This is a hypothesis from the recorded evidence; it is not confirmed.",
          debuggingSteps: ["Inspect the Submit control."],
          fixSuggestions: [{ suggestion: "Update the locator.", evidenceBasis: "Step 1 failed." }],
        },
        source: "fallback",
        model: null,
        analyzedAt: "2026-10-19T00:02:00.000Z",
      },
    },
    {
      resultId: "77777777-7777-4777-8777-777777777777",
      testCaseId: "44444444-4444-4333-8444-444444444444",
      caseTitle: "Home loads",
      outcome: "pass",
      executionStatus: "passed",
      browserJobId: "99999999-9999-4999-8999-999999999999",
      attempts: 1,
      failureKind: null,
      durationMs: 1000,
      steps: [{ index: 0, action: "goto", ok: true, durationMs: 200, error: null }],
      expected: null,
      actual: null,
      logs: { consoleErrors: [], networkErrors: [] },
      artifacts: [],
      analysis: null,
    },
  ],
};

function renderDetail(
  detail: Detail = DETAIL,
  comparisonRuns: Array<{ id: string; name: string; createdAt: string }> = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Earlier",
      createdAt: "2026-10-18T00:00:00.000Z",
    },
  ],
) {
  return render(
    <AutomatedRunDetail
      workspaceId={WS}
      projectId="22222222-2222-4222-8222-222222222222"
      projectName="Demo project"
      initialDetail={detail}
      comparisonRuns={comparisonRuns}
    />,
  );
}

describe("AutomatedRunDetail", () => {
  it("renders run status, duration, and the execution summary", () => {
    renderDetail();
    expect(screen.getByText("Nightly")).toBeInTheDocument();
    expect(screen.getByText(/1m 0s/)).toBeInTheDocument();
    expect(screen.getByText("Passed: 1")).toBeInTheDocument();
    expect(screen.getByText("Failed: 1")).toBeInTheDocument();
  });

  it("shows expected vs actual, sanitized logs, and failure artifacts", () => {
    renderDetail();
    expect(screen.getByText('role button "Submit" to be clickable')).toBeInTheDocument();
    // Appears both as the step error and in the Actual block.
    expect(screen.getAllByText("locator not found")).toHaveLength(2);
    expect(screen.getByText("TypeError: boom")).toBeInTheDocument();
    expect(screen.getByText("step-1.png")).toBeInTheDocument();
    expect(screen.getAllByText(/Traces are not captured by design/)).toHaveLength(2);
  });

  it("renders AI analysis with uncertainty and the hypothesis disclaimer", () => {
    renderDetail();
    expect(screen.getByText("Hypothesis: the locator no longer matches.")).toBeInTheDocument();
    expect(screen.getByText(/hypothesis from the recorded evidence/)).toBeInTheDocument();
    expect(screen.getByText(/A hypothesis based on the recorded evidence/)).toBeInTheDocument();
    expect(screen.getByText(/based on: Step 1 failed\./)).toBeInTheDocument();
  });

  it("offers analysis for a failed result that has none yet", () => {
    const without: Detail = {
      ...DETAIL,
      results: [{ ...DETAIL.results[0]!, analysis: null }],
    };
    renderDetail(without);
    expect(screen.getByRole("button", { name: "Analyze failure" })).toBeInTheDocument();
  });

  it("offers the run-comparison picker when other automated runs exist", () => {
    renderDetail();
    expect(screen.getByLabelText("Run to compare with")).toBeInTheDocument();
  });

  it("hides comparison when there are no other runs", () => {
    renderDetail(DETAIL, []);
    expect(screen.queryByLabelText("Run to compare with")).not.toBeInTheDocument();
  });
});
