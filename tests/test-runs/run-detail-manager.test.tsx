/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunDetailManager } from "@/components/test-runs/run-detail-manager";
import type { TestRunWithSummary } from "@/lib/test-runs/actions";
import type { RunResult } from "@schemas/test-run";

const { setResultOutcomeMock, completeRunMock, reopenRunMock } = vi.hoisted(() => ({
  setResultOutcomeMock: vi.fn(),
  completeRunMock: vi.fn(),
  reopenRunMock: vi.fn(),
}));

vi.mock("@/lib/test-runs/actions", () => ({
  setResultOutcome: (...args: unknown[]) => setResultOutcomeMock(...args),
  completeRun: (...args: unknown[]) => completeRunMock(...args),
  reopenRun: (...args: unknown[]) => reopenRunMock(...args),
}));

afterEach(() => cleanup());

const WS_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

const RUN: TestRunWithSummary = {
  id: RUN_ID,
  workspaceId: WS_ID,
  projectId: PROJECT_ID,
  suiteId: null,
  name: "Sprint 1",
  source: "manual",
  status: "in_progress",
  executionStatus: null,
  notes: null,
  createdBy: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
  completedAt: null,
  summary: { total: 1, unexecuted: 1, pass: 0, fail: 0, blocked: 0, skipped: 0 },
};

const RESULT: RunResult = {
  id: "77777777-7777-4777-8777-777777777777",
  runId: RUN_ID,
  workspaceId: WS_ID,
  testCaseId: "55555555-5555-4555-8555-555555555555",
  snapshot: {
    title: "Login works",
    description: null,
    preconditions: null,
    steps: [{ action: "Enter credentials", expected: "Dashboard opens" }],
    expectedResults: null,
    priority: "high",
    tags: [],
    caseStatus: "active",
  },
  outcome: "unexecuted",
  browserJobId: null,
  executionStatus: null,
  artifacts: [],
  notes: null,
  executedBy: null,
  executedAt: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
};

function renderDetail(run = RUN, results = [RESULT]) {
  return render(
    <RunDetailManager
      workspaceId={WS_ID}
      projectId={PROJECT_ID}
      projectName="Billing API"
      initialRun={run}
      initialResults={results}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RunDetailManager", () => {
  it("renders the run, summary, and frozen snapshot steps", async () => {
    renderDetail();
    expect(screen.getByRole("heading", { name: "Sprint 1" })).toBeInTheDocument();
    expect(screen.getByText("Login works")).toBeInTheDocument();
    expect(screen.getByText("View frozen steps (1)")).toBeInTheDocument();
  });

  it("saves a result outcome with notes", async () => {
    const user = userEvent.setup();
    const updated = { ...RESULT, outcome: "pass" as const, notes: "Worked." };
    setResultOutcomeMock.mockResolvedValue({ ok: true, data: updated });
    renderDetail();

    await user.selectOptions(screen.getByLabelText("Outcome"), "pass");
    await user.type(screen.getByLabelText("Notes"), "Worked.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(setResultOutcomeMock).toHaveBeenCalledWith(WS_ID, PROJECT_ID, RUN_ID, RESULT.id, {
      outcome: "pass",
      notes: "Worked.",
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("completes the run and locks result editing", async () => {
    const user = userEvent.setup();
    const completed = { ...RUN, status: "completed" as const };
    completeRunMock.mockResolvedValue({ ok: true, data: completed });
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Complete run" }));
    expect(completeRunMock).toHaveBeenCalledWith(WS_ID, PROJECT_ID, RUN_ID);
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(
      screen.getByText("This run is completed. Reopen it to change results."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Outcome")).not.toBeInTheDocument();
  });

  it("reopens a completed run", async () => {
    const user = userEvent.setup();
    const completed = { ...RUN, status: "completed" as const };
    reopenRunMock.mockResolvedValue({ ok: true, data: RUN });
    renderDetail(completed);

    await user.click(screen.getByRole("button", { name: "Reopen run" }));
    expect(reopenRunMock).toHaveBeenCalledWith(WS_ID, PROJECT_ID, RUN_ID);
    expect(await screen.findByText("In progress")).toBeInTheDocument();
  });
});
