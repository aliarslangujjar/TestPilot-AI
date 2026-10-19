/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunsManager } from "@/components/test-runs/runs-manager";
import type { TestRunWithSummary } from "@/lib/test-runs/actions";

const { listRunsMock } = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
}));

vi.mock("@/lib/test-runs/actions", () => ({
  listRuns: (...args: unknown[]) => listRunsMock(...args),
  createRun: vi.fn(),
}));

vi.mock("@/components/test-runs/run-form-dialog", () => ({
  RunFormDialog: () => <div data-testid="run-form-dialog" />,
}));

afterEach(() => cleanup());

const WS_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

const RUN: TestRunWithSummary = {
  id: "66666666-6666-4666-8666-666666666666",
  workspaceId: WS_ID,
  projectId: PROJECT_ID,
  suiteId: null,
  name: "Sprint 1",
  source: "manual",
  status: "in_progress",
  notes: null,
  createdBy: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
  completedAt: null,
  summary: { total: 3, unexecuted: 1, pass: 1, fail: 1, blocked: 0, skipped: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  listRunsMock.mockResolvedValue({ ok: true, data: [RUN] });
});

function renderManager() {
  return render(
    <RunsManager workspaceId={WS_ID} projectId={PROJECT_ID} projectName="Billing API" />,
  );
}

describe("RunsManager", () => {
  it("lists runs with their summaries", async () => {
    renderManager();
    expect(await screen.findByText("Sprint 1")).toBeInTheDocument();
    expect(screen.getByText("In progress", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(listRunsMock).toHaveBeenCalledWith(WS_ID, PROJECT_ID, { status: undefined });
  });

  it("shows the empty state", async () => {
    listRunsMock.mockResolvedValue({ ok: true, data: [] });
    renderManager();
    expect(await screen.findByText("No test runs yet")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    renderManager();
    expect(await screen.findByText("Sprint 1")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    expect(listRunsMock).toHaveBeenLastCalledWith(WS_ID, PROJECT_ID, {
      status: "completed",
    });
  });

  it("opens the new-run dialog", async () => {
    const user = userEvent.setup();
    renderManager();
    expect(await screen.findByText("Sprint 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New run" }));
    expect(screen.getByTestId("run-form-dialog")).toBeInTheDocument();
  });
});
