/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReviewWorkspace } from "@/components/ai-review/review-workspace";
import type { GeneratedCase } from "@schemas/ai-review";

const { saveReviewedCasesMock } = vi.hoisted(() => ({
  saveReviewedCasesMock: vi.fn(),
}));

vi.mock("@/lib/ai-review/actions", () => ({
  saveReviewedCases: (...args: unknown[]) => saveReviewedCasesMock(...args),
}));

afterEach(() => cleanup());

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const SUITE = "33333333-3333-4333-8333-333333333333";
const TEMP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function draftA(): GeneratedCase {
  return {
    tempId: TEMP_A,
    title: "Login with valid credentials",
    description: "",
    preconditions: "",
    steps: [{ action: "Submit the form", expected: "The page loads successfully" }],
    expectedResults: "The user lands on the dashboard",
    priority: "medium",
    tags: [],
    objective: "",
    coverage: null,
    assumptions: [],
  };
}

function draftB(): GeneratedCase {
  return {
    tempId: TEMP_B,
    title: "Login with valid credentials",
    description: "",
    preconditions: "",
    steps: [{ action: "Submit the form", expected: "Dashboard shows the username" }],
    expectedResults: "The user lands on the dashboard",
    priority: "high",
    tags: [],
    objective: "",
    coverage: null,
    assumptions: [],
  };
}

const baseProps = {
  workspaceId: WS,
  projectId: PROJECT,
  suiteId: SUITE,
  existingCases: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  saveReviewedCasesMock.mockResolvedValue({ ok: true, data: { created: 1, ids: ["new-id"] } });
});

describe("ReviewWorkspace", () => {
  it("accepting a suggestion updates the draft text", async () => {
    const user = userEvent.setup();
    render(<ReviewWorkspace {...baseProps} initialDrafts={[draftA()]} />);

    // The vague step expectation is flagged; accept the rewrite suggestion.
    expect(screen.getAllByText(/ambiguous expected result/i).length).toBeGreaterThan(0);
    const suggestionRow = screen.getByText("Insert observable-outcome placeholder").closest("li")!;
    await user.click(within(suggestionRow).getByRole("button", { name: "Accept" }));

    const expectedInput = screen.getAllByLabelText("Expected")[0] as HTMLInputElement;
    expect(expectedInput.value).toContain("[TODO: describe the exact observable outcome]");
    // Flag cleared after the fix.
    expect(screen.queryByText(/ambiguous expected result/i)).not.toBeInTheDocument();
  });

  it("blocks approval on unresolved blockers until acknowledged", async () => {
    const user = userEvent.setup();
    render(
      <ReviewWorkspace
        {...baseProps}
        initialDrafts={[draftB()]}
        existingCases={[{ id: "e1", title: "Login with valid credentials" }]}
      />,
    );

    expect(screen.getAllByText(/possible duplicate/i).length).toBeGreaterThan(0);
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /acknowledge as-is/i }));
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("approved")).toBeInTheDocument();
  });

  it("saves approved drafts exactly as approved, as drafts", async () => {
    const user = userEvent.setup();
    render(<ReviewWorkspace {...baseProps} initialDrafts={[draftA()]} />);

    // Edit the title, then approve.
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Login with valid credentials v2");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: /save 1 approved as draft/i }));

    expect(saveReviewedCasesMock).toHaveBeenCalledTimes(1);
    const submission = saveReviewedCasesMock.mock.calls[0]?.[0] as {
      workspaceId: string;
      projectId: string;
      suiteId: string;
      approvedTempIds: string[];
      cases: GeneratedCase[];
    };
    expect(submission.workspaceId).toBe(WS);
    expect(submission.projectId).toBe(PROJECT);
    expect(submission.suiteId).toBe(SUITE);
    expect(submission.approvedTempIds).toEqual([TEMP_A]);
    expect(submission.cases).toHaveLength(1);
    // Exactly the approved content — no silent modification.
    expect(submission.cases[0]?.title).toBe("Login with valid credentials v2");
    expect(submission.cases[0]?.steps).toEqual(draftA().steps);
    expect(await screen.findByText(/saved 1 case as drafts/i)).toBeInTheDocument();
  });

  it("shows the honesty note that generated cases are not coverage", async () => {
    render(<ReviewWorkspace {...baseProps} initialDrafts={[draftA()]} />);
    expect(screen.getByText(/nothing here is coverage/i)).toBeInTheDocument();
  });
});
