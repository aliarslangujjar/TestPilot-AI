/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TestManagement } from "@/components/test-management/test-management";
import type { Suite } from "@schemas/suite";
import type { TestCase } from "@schemas/test-case";

const WS_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "33333333-3333-3333-3333-333333333333";
const SUITE_ID = "44444444-4444-4444-4444-444444444444";

const {
  listSuitesMock,
  createSuiteMock,
  setSuiteArchivedMock,
  listTestCasesMock,
  createTestCaseMock,
  setTestCaseArchivedMock,
} = vi.hoisted(() => ({
  listSuitesMock: vi.fn(),
  createSuiteMock: vi.fn(),
  setSuiteArchivedMock: vi.fn(),
  listTestCasesMock: vi.fn(),
  createTestCaseMock: vi.fn(),
  setTestCaseArchivedMock: vi.fn(),
}));

vi.mock("@/lib/suites/actions", () => ({
  listSuites: (...args: unknown[]) => listSuitesMock(...args),
  createSuite: (...args: unknown[]) => createSuiteMock(...args),
  updateSuite: vi.fn(),
  setSuiteArchived: (...args: unknown[]) => setSuiteArchivedMock(...args),
  duplicateSuite: vi.fn(),
  getSuite: vi.fn(),
}));

vi.mock("@/lib/test-cases/actions", () => ({
  listTestCases: (...args: unknown[]) => listTestCasesMock(...args),
  createTestCase: (...args: unknown[]) => createTestCaseMock(...args),
  updateTestCase: vi.fn(),
  setTestCaseArchived: (...args: unknown[]) => setTestCaseArchivedMock(...args),
  duplicateTestCase: vi.fn(),
  getTestCase: vi.fn(),
}));

afterEach(() => cleanup());

const SUITE: Suite = {
  id: SUITE_ID,
  workspaceId: WS_ID,
  projectId: PROJECT_ID,
  name: "Smoke tests",
  description: null,
  isArchived: false,
  createdBy: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T12:00:00.000Z",
};

const CASE: TestCase = {
  id: "55555555-5555-5555-5555-555555555555",
  workspaceId: WS_ID,
  suiteId: SUITE_ID,
  title: "Login works",
  description: null,
  preconditions: null,
  steps: [{ action: "Enter credentials", expected: "Dashboard opens" }],
  expectedResults: null,
  priority: "high",
  tags: ["smoke"],
  status: "active",
  isArchived: false,
  createdBy: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listSuitesMock.mockResolvedValue({ ok: true, data: [SUITE] });
  listTestCasesMock.mockResolvedValue({ ok: true, data: [CASE] });
});

function renderManagement() {
  return render(
    <TestManagement workspaceId={WS_ID} projectId={PROJECT_ID} projectName="Billing API" />,
  );
}

describe("TestManagement", () => {
  it("loads suites, auto-selects the first, and loads its test cases", async () => {
    renderManagement();
    expect(screen.getByLabelText("Loading suites")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Smoke tests" })).toBeInTheDocument();
    expect(listTestCasesMock).toHaveBeenCalledWith(WS_ID, PROJECT_ID, SUITE_ID, expect.anything());
    expect(await screen.findByText("Login works")).toBeInTheDocument();
  });

  it("shows the empty suites state", async () => {
    listSuitesMock.mockResolvedValue({ ok: true, data: [] });
    renderManagement();
    expect(await screen.findByText("No suites yet")).toBeInTheDocument();
  });

  it("creates a suite and shows a notice", async () => {
    const user = userEvent.setup();
    const created = { ...SUITE, id: "66666666-6666-6666-6666-666666666666", name: "Regression" };
    createSuiteMock.mockResolvedValue({ ok: true, data: created });
    renderManagement();
    expect(await screen.findByRole("button", { name: "Smoke tests" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New suite" }));
    await user.type(screen.getByLabelText("Name"), "Regression");
    await user.click(screen.getByRole("button", { name: "Create suite" }));

    expect(createSuiteMock).toHaveBeenCalledWith(
      WS_ID,
      PROJECT_ID,
      expect.objectContaining({ name: "Regression" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Suite “Regression” created.");
  });

  it("archives a suite after confirmation", async () => {
    const user = userEvent.setup();
    listTestCasesMock.mockResolvedValue({ ok: true, data: [] });
    setSuiteArchivedMock.mockResolvedValue({ ok: true, data: SUITE });
    renderManagement();
    expect(await screen.findByRole("button", { name: "Smoke tests" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText("Archive this suite?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(setSuiteArchivedMock).toHaveBeenCalledWith(WS_ID, PROJECT_ID, SUITE_ID, true);
    expect(await screen.findByRole("status")).toHaveTextContent("archived");
  });

  it("creates a test case with steps", async () => {
    const user = userEvent.setup();
    const created = { ...CASE, id: "77777777-7777-7777-7777-777777777777", title: "Logout works" };
    createTestCaseMock.mockResolvedValue({ ok: true, data: created });
    renderManagement();
    expect(await screen.findByText("Login works")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New test case" }));
    await user.type(screen.getByLabelText("Title"), "Logout works");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    await user.type(screen.getByLabelText("Action"), "Click logout");
    await user.type(screen.getByLabelText("Expected (optional)"), "Signed out");
    await user.click(screen.getByRole("button", { name: "Create test case" }));

    expect(createTestCaseMock).toHaveBeenCalledWith(
      WS_ID,
      PROJECT_ID,
      SUITE_ID,
      expect.objectContaining({
        title: "Logout works",
        steps: [{ action: "Click logout", expected: "Signed out" }],
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Test case “Logout works” created.",
    );
  });

  it("shows the empty test-cases state for a suite", async () => {
    listTestCasesMock.mockResolvedValue({ ok: true, data: [] });
    renderManagement();
    expect(await screen.findByText("No test cases yet")).toBeInTheDocument();
  });
});
