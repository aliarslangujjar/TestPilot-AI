/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneratePlanDialog } from "@/components/test-plans/generate-plan-dialog";

const { getAIStatusMock, generateTestPlanMock } = vi.hoisted(() => ({
  getAIStatusMock: vi.fn(),
  generateTestPlanMock: vi.fn(),
}));

vi.mock("@/lib/ai/service", () => ({
  getAIStatus: (...args: unknown[]) => getAIStatusMock(...args),
}));

vi.mock("@/lib/test-plans/actions", () => ({
  generateTestPlan: (...args: unknown[]) => generateTestPlanMock(...args),
}));

vi.mock("@/components/ai-review/review-workspace", () => ({
  ReviewWorkspace: ({
    initialDrafts,
    onSaved,
  }: {
    initialDrafts: unknown[];
    onSaved?: (n: number) => void;
  }) => (
    <div data-testid="review-stub">
      <span>{initialDrafts.length} drafts for review</span>
      <button type="button" onClick={() => onSaved?.(initialDrafts.length)}>
        Save approved
      </button>
    </div>
  ),
}));

afterEach(() => cleanup());

const props = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  suiteId: "33333333-3333-4333-8333-333333333333",
  existingCases: [],
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

const SOURCE = "As a shopper I want to apply a discount code at checkout.";

beforeEach(() => {
  vi.clearAllMocks();
  props.onClose = vi.fn();
  props.onSaved = vi.fn();
  getAIStatusMock.mockResolvedValue({
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini",
    dailyRequests: 0,
    dailyTokens: 0,
  });
});

describe("GeneratePlanDialog", () => {
  it("shows the disabled notice when AI is off", async () => {
    getAIStatusMock.mockResolvedValue({ enabled: false });
    render(<GeneratePlanDialog {...props} />);
    expect(await screen.findByText("AI is not enabled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate plan" })).not.toBeInTheDocument();
  });

  it("shows a usage estimate once the source is long enough", async () => {
    const user = userEvent.setup();
    render(<GeneratePlanDialog {...props} />);
    await user.type(await screen.findByLabelText("User story"), SOURCE);
    expect(await screen.findByText(/estimated usage/i)).toBeInTheDocument();
    expect(screen.getByText(/estimates are approximate/i)).toBeInTheDocument();
  });

  it("shows a retryable error state on failure", async () => {
    const user = userEvent.setup();
    generateTestPlanMock.mockResolvedValue({
      ok: false,
      error: "Timed out.",
      code: "AI_TIMEOUT",
    });
    render(<GeneratePlanDialog {...props} />);
    await user.type(await screen.findByLabelText("User story"), SOURCE);
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/timed out/i);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(generateTestPlanMock).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state, then hands the drafts to review", async () => {
    const user = userEvent.setup();
    let resolveGen!: (value: unknown) => void;
    generateTestPlanMock.mockReturnValue(new Promise((r) => (resolveGen = r)));
    render(<GeneratePlanDialog {...props} />);
    await user.type(await screen.findByLabelText("User story"), SOURCE);
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(await screen.findByText("Generating test plan…")).toBeInTheDocument();

    resolveGen({
      ok: true,
      data: {
        cases: [
          {
            tempId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            title: "Case one",
            description: "",
            preconditions: "",
            steps: [],
            expectedResults: "",
            priority: "medium",
            tags: [],
            objective: "obj",
            coverage: null,
            assumptions: [],
          },
        ],
        summary: "Summary.",
        estimate: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "gpt-4o-mini",
      },
    });
    expect(await screen.findByText("1 drafts for review")).toBeInTheDocument();
    // Nothing is claimed as executed.
    expect(screen.getByText(/nothing here has executed/i)).toBeInTheDocument();
  });

  it("saving from review notifies the parent and closes", async () => {
    const user = userEvent.setup();
    generateTestPlanMock.mockResolvedValue({
      ok: true,
      data: {
        cases: [],
        summary: "",
        estimate: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "gpt-4o-mini",
      },
    });
    render(<GeneratePlanDialog {...props} />);
    await user.type(await screen.findByLabelText("User story"), SOURCE);
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    await user.click(await screen.findByRole("button", { name: "Save approved" }));
    expect(props.onSaved).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
