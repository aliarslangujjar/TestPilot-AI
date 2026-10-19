/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunFormDialog } from "@/components/test-runs/run-form-dialog";

const { listSuitesMock, listTestCasesMock, createRunMock } = vi.hoisted(() => ({
  listSuitesMock: vi.fn(),
  listTestCasesMock: vi.fn(),
  createRunMock: vi.fn(),
}));

vi.mock("@/lib/suites/actions", () => ({
  listSuites: (...args: unknown[]) => listSuitesMock(...args),
}));

vi.mock("@/lib/test-cases/actions", () => ({
  listTestCases: (...args: unknown[]) => listTestCasesMock(...args),
}));

vi.mock("@/lib/test-runs/actions", () => ({
  createRun: (...args: unknown[]) => createRunMock(...args),
}));

afterEach(() => cleanup());

const WS_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SUITE_ID = "44444444-4444-4444-8444-444444444444";

const SUITE = {
  id: SUITE_ID,
  workspaceId: WS_ID,
  projectId: PROJECT_ID,
  name: "Smoke tests",
  description: null,
  isArchived: false,
  createdBy: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
};

const CASE = {
  id: "55555555-5555-4555-8555-555555555555",
  workspaceId: WS_ID,
  suiteId: SUITE_ID,
  title: "Login works",
  description: null,
  preconditions: null,
  steps: [{ action: "Enter credentials", expected: "Dashboard opens" }],
  expectedResults: null,
  priority: "high",
  tags: [],
  status: "active",
  isArchived: false,
  createdBy: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listSuitesMock.mockResolvedValue({ ok: true, data: [SUITE] });
  listTestCasesMock.mockResolvedValue({ ok: true, data: [CASE] });
});

function renderDialog(onCreated = vi.fn()) {
  return render(
    <RunFormDialog
      workspaceId={WS_ID}
      projectId={PROJECT_ID}
      onClose={vi.fn()}
      onCreated={onCreated}
    />,
  );
}

describe("RunFormDialog", () => {
  it("loads the suite's active cases checked by default and creates the run", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    createRunMock.mockResolvedValue({
      ok: true,
      data: { id: "r1", name: "Sprint 1", summary: { total: 1 } },
    });
    renderDialog(onCreated);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Login works")).toBeInTheDocument();
    const checkbox = within(dialog).getByRole("checkbox", { name: /login works/i });
    expect(checkbox).toBeChecked();

    await user.type(within(dialog).getByLabelText("Run name"), "Sprint 1");
    await user.click(within(dialog).getByRole("button", { name: "Create run" }));

    expect(createRunMock).toHaveBeenCalledWith(
      WS_ID,
      PROJECT_ID,
      expect.objectContaining({
        name: "Sprint 1",
        suiteId: SUITE_ID,
        testCaseIds: [CASE.id],
      }),
    );
    expect(onCreated).toHaveBeenCalled();
  });

  it("requires a name before calling the server", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Login works")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create run" }));
    expect(createRunMock).not.toHaveBeenCalled();
    expect(
      await within(dialog).findByText("Run name must be at least 2 characters."),
    ).toBeInTheDocument();
  });
});
