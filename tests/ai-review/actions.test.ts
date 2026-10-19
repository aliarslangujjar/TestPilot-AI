/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveReviewedCases } from "@/lib/ai-review/actions";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import type { GeneratedCase } from "@schemas/ai-review";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SUITE_ID = "33333333-3333-4333-8333-333333333333";
const TEMP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const { requireWorkspaceClientMock, createTestCaseMock, fromMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
  createTestCaseMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/test-cases/actions", () => ({
  createTestCase: (...args: unknown[]) => createTestCaseMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

function mockQuery(result: { data?: unknown; error?: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "maybeSingle"]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown) => void) =>
    resolve({ data: result.data ?? null, error: result.error ?? null });
  return q;
}

function generatedCase(tempId: string, title: string): GeneratedCase {
  return {
    tempId,
    title,
    description: "desc",
    preconditions: "pre",
    steps: [{ action: "Do it", expected: "It happens" }],
    expectedResults: "Done",
    priority: "high",
    tags: ["smoke"],
    objective: "Verifies the thing.",
    coverage: "negative",
    assumptions: ["Assumed the user is signed in."],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceClientMock.mockResolvedValue({
    supabase: { from: fromMock },
    userId: "user-1",
  });
  fromMock.mockImplementation(() => mockQuery({ data: { id: SUITE_ID } }));
  createTestCaseMock.mockImplementation(
    async (_ws: string, _p: string, _s: string, input: Record<string, unknown>) => ({
      ok: true,
      data: { id: `created-${input.title}` },
    }),
  );
});

describe("saveReviewedCases", () => {
  it("denies non-members without touching the suite or cases", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS_ID, "not a member"),
    );
    const result = await saveReviewedCases({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      suiteId: SUITE_ID,
      cases: [generatedCase(TEMP_A, "Case A")],
      approvedTempIds: [TEMP_A],
    });
    expect(result).toEqual({ ok: false, error: "You don't have access to this workspace." });
    expect(createTestCaseMock).not.toHaveBeenCalled();
  });

  it("rejects approved ids missing from the submission", async () => {
    const result = await saveReviewedCases({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      suiteId: SUITE_ID,
      cases: [generatedCase(TEMP_A, "Case A")],
      approvedTempIds: [TEMP_B],
    });
    expect(result.ok).toBe(false);
    expect(createTestCaseMock).not.toHaveBeenCalled();
  });

  it("saves only approved cases, exactly as approved, forced to draft", async () => {
    const result = await saveReviewedCases({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      suiteId: SUITE_ID,
      cases: [generatedCase(TEMP_A, "Case A"), generatedCase(TEMP_B, "Case B")],
      approvedTempIds: [TEMP_A],
    });

    expect(result).toEqual({ ok: true, data: { created: 1, ids: ["created-Case A"] } });
    expect(createTestCaseMock).toHaveBeenCalledTimes(1);
    const input = createTestCaseMock.mock.calls[0]?.[3] as Record<string, unknown>;
    // Exact approved content — the only change is the forced draft status.
    expect(input).toEqual({
      title: "Case A",
      description: "desc",
      preconditions: "pre",
      steps: [{ action: "Do it", expected: "It happens" }],
      expectedResults: "Done",
      priority: "high",
      tags: ["smoke"],
      status: "draft",
      objective: "Verifies the thing.",
      coverage: "negative",
      assumptions: ["Assumed the user is signed in."],
    });
  });

  it("refuses when the suite is outside the workspace", async () => {
    fromMock.mockImplementation(() => mockQuery({ data: null }));
    const result = await saveReviewedCases({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      suiteId: SUITE_ID,
      cases: [generatedCase(TEMP_A, "Case A")],
      approvedTempIds: [TEMP_A],
    });
    expect(result).toEqual({ ok: false, error: "Suite not found." });
    expect(createTestCaseMock).not.toHaveBeenCalled();
  });
});
