/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateTestPlan } from "@/lib/test-plans/actions";
import { AIServiceError } from "@/lib/ai/errors";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS_ID = "11111111-1111-4111-8111-111111111111";

const { requireWorkspaceClientMock, generateStructuredMock, getAIStatusMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
  generateStructuredMock: vi.fn(),
  getAIStatusMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/ai/service", () => ({
  generateStructured: (...args: unknown[]) => generateStructuredMock(...args),
  getAIStatus: (...args: unknown[]) => getAIStatusMock(...args),
}));

function plannedCase(coverage: "positive" | "negative" | "boundary", title: string) {
  return {
    title,
    objective: `Verifies ${title.toLowerCase()}.`,
    preconditions: "",
    steps: [{ action: "Do it", expected: "It happens observably." }],
    expectedResults: "Observable outcome.",
    priority: "medium" as const,
    coverage,
    assumptions: [],
  };
}

const request = {
  workspaceId: WS_ID,
  sourceKind: "user_story" as const,
  sourceText: "As a shopper I want to apply a discount code at checkout.",
  maxCases: 8,
  includeNegative: true,
  includeBoundary: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceClientMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
  getAIStatusMock.mockResolvedValue({
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini",
    dailyRequests: 0,
    dailyTokens: 0,
  });
  generateStructuredMock.mockResolvedValue({
    data: {
      summary: "Plan summary.",
      cases: [
        plannedCase("positive", "Apply valid code"),
        plannedCase("negative", "Reject expired code"),
        plannedCase("boundary", "Code at max length"),
      ],
    },
    usage: { inputTokens: 500, outputTokens: 700 },
  });
});

describe("generateTestPlan", () => {
  it("maps the plan to review-ready drafts with coverage tags", async () => {
    const result = await generateTestPlan(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cases).toHaveLength(3);
    const [first] = result.data.cases;
    expect(first?.tempId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(first?.objective).toBe("Verifies apply valid code.");
    expect(first?.coverage).toBe("positive");
    expect(first?.tags).toEqual(["positive"]);
    expect(result.data.summary).toBe("Plan summary.");
    expect(result.data.model).toBe("gpt-4o-mini");
    expect(result.data.estimate.costUsd).toBeGreaterThanOrEqual(0);
    expect(result.data.usage).toEqual({ inputTokens: 500, outputTokens: 700 });
  });

  it("rejects the plan when requested negative cases are missing", async () => {
    generateStructuredMock.mockResolvedValue({
      data: {
        summary: "All positive.",
        cases: [plannedCase("positive", "Apply valid code")],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const result = await generateTestPlan(request);
    expect(result).toEqual({
      ok: false,
      error: "The AI returned no negative cases although they were requested.",
      code: "AI_INVALID_RESPONSE",
    });
  });

  it("denies non-members without calling the provider", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS_ID, "not a member"),
    );
    const result = await generateTestPlan(request);
    expect(result).toEqual({
      ok: false,
      error: "You don't have access to this workspace.",
    });
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("passes provider error codes through to the UI", async () => {
    generateStructuredMock.mockRejectedValue(
      new AIServiceError("AI_QUOTA_EXCEEDED", "Daily AI request quota exceeded."),
    );
    const result = await generateTestPlan(request);
    expect(result).toEqual({
      ok: false,
      error: "Daily AI request quota exceeded.",
      code: "AI_QUOTA_EXCEEDED",
    });
  });

  it("rejects short source text before any AI call", async () => {
    const result = await generateTestPlan({ ...request, sourceText: "short" });
    expect(result.ok).toBe(false);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });
});
