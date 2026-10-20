/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  convertTestPlan,
  deleteTestPlan,
  generateAndStoreTestPlan,
  listTestPlans,
} from "@/lib/test-plans/plans";
import { AIServiceError } from "@/lib/ai/errors";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const SUITE = "44444444-4444-4333-8444-444444444444";

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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface RecordedOp {
  table: string;
  op: "insert" | "update" | "delete";
  payload?: unknown;
}

/** Thenable chain mock with per-table preset { data, error } and op recording. */
function mockDb(presets: Record<string, { data: unknown; error: unknown }>) {
  const ops: RecordedOp[] = [];
  function chain(table: string) {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.in = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.limit = vi.fn(() => q);
    q.maybeSingle = vi.fn(() => q);
    q.single = vi.fn(() => q);
    q.insert = vi.fn((rows: unknown) => {
      ops.push({ table, op: "insert", payload: rows });
      return q;
    });
    q.update = vi.fn((patch: unknown) => {
      ops.push({ table, op: "update", payload: patch });
      return q;
    });
    q.delete = vi.fn(() => {
      ops.push({ table, op: "delete" });
      return q;
    });
    q.then = (resolve: (value: unknown) => void) => {
      const preset = presets[table] ?? { data: null, error: null };
      resolve(preset);
    };
    return q;
  }
  return { ops, from: vi.fn((t: string) => chain(t)) };
}

function generatedCase(
  testType: "functional" | "negative" | "security",
  title: string,
  area = "Checkout",
) {
  return {
    title,
    objective: `Verifies ${title.toLowerCase()}.`,
    preconditions: "",
    steps: [{ action: "Do it", expected: "It happens observably." }],
    expectedResults: "Observable outcome.",
    priority: "medium" as const,
    coverage: (testType === "negative" ? "negative" : "positive") as "positive" | "negative",
    testType,
    area,
    assumptions: [],
  };
}

const VALID_PLAN = {
  summary: "Covers checkout.",
  cases: [
    generatedCase("functional", "Complete a purchase"),
    generatedCase("negative", "Reject expired card"),
    generatedCase("security", "Reject tampered total"),
  ],
};

function draftPlanRow(status: "draft" | "converted" = "draft") {
  return {
    id: PLAN,
    workspace_id: WS,
    project_id: PROJECT,
    name: "Checkout plan",
    template_key: "ecommerce",
    source_kind: "user_story",
    source_text: "As a shopper I want to check out with a card.",
    settings: {
      testTypes: ["functional", "negative", "security"],
      coverageAreas: ["Checkout"],
      priorityStrategy: "risk_first",
      maxCases: 12,
    },
    plan: VALID_PLAN,
    model: "gpt-4o-mini",
    status,
    suite_id: status === "converted" ? SUITE : null,
    created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
  };
}

const request = {
  workspaceId: WS,
  projectId: PROJECT,
  name: "Checkout plan",
  sourceKind: "user_story" as const,
  sourceText: "As a shopper I want to check out with a card.",
  templateKey: "ecommerce",
  testTypes: ["functional", "negative", "security"] as const,
  coverageAreas: ["Checkout"],
  priorityStrategy: "risk_first" as const,
  maxCases: 12,
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
    data: VALID_PLAN,
    usage: { inputTokens: 500, outputTokens: 900 },
  });
});

describe("generateAndStoreTestPlan", () => {
  it("stores a validated plan as a draft with its settings and model", async () => {
    const { ops, from } = mockDb({
      projects: { data: { id: PROJECT }, error: null },
      test_plans: { data: draftPlanRow(), error: null },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });

    const res = await generateAndStoreTestPlan(request);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.plan.status).toBe("draft");
    expect(res.data.plan.plan.cases).toHaveLength(3);
    expect(res.data.plan.model).toBe("gpt-4o-mini");

    const inserts = ops.filter((o) => o.table === "test_plans" && o.op === "insert");
    expect(inserts).toHaveLength(1);
    const payload = inserts[0]?.payload as Record<string, unknown>;
    expect(payload.status).toBe("draft");
    expect((payload.settings as { testTypes: string[] }).testTypes).toEqual([
      "functional",
      "negative",
      "security",
    ]);
    expect((payload.plan as { cases: unknown[] }).cases).toHaveLength(3);
  });

  it("rejects an unknown template before any AI call", async () => {
    requireWorkspaceClientMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
    const res = await generateAndStoreTestPlan({ ...request, templateKey: "nope" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Unknown template.");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("persists nothing when the model omits a requested test type", async () => {
    const { ops, from } = mockDb({
      projects: { data: { id: PROJECT }, error: null },
      test_plans: { data: null, error: null },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });
    generateStructuredMock.mockResolvedValue({
      data: {
        summary: "Partial.",
        cases: [
          generatedCase("functional", "Complete a purchase"),
          generatedCase("negative", "Reject expired card"),
        ],
      },
      usage: { inputTokens: 100, outputTokens: 100 },
    });

    const res = await generateAndStoreTestPlan(request);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("no security cases");
    expect(ops.filter((o) => o.table === "test_plans" && o.op === "insert")).toHaveLength(0);
  });

  it("persists nothing when AI is disabled", async () => {
    const { ops, from } = mockDb({
      projects: { data: { id: PROJECT }, error: null },
      test_plans: { data: null, error: null },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });
    generateStructuredMock.mockRejectedValue(
      new AIServiceError("AI_DISABLED", "AI is not enabled."),
    );

    const res = await generateAndStoreTestPlan(request);
    expect(res.ok).toBe(false);
    expect(res.ok === false && (res as { code?: string }).code).toBe("AI_DISABLED");
    expect(ops.filter((o) => o.table === "test_plans" && o.op === "insert")).toHaveLength(0);
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await generateAndStoreTestPlan(request);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("You don't have access to this workspace.");
  });
});

describe("convertTestPlan", () => {
  it("creates a suite and draft cases, then marks the plan converted", async () => {
    const { ops, from } = mockDb({
      test_plans: { data: draftPlanRow("draft"), error: null },
      suites: { data: { id: SUITE }, error: null },
      test_cases: { data: [], error: null },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });

    const res = await convertTestPlan(WS, PROJECT, PLAN, { suiteName: "Checkout suite" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.suiteId).toBe(SUITE);
    expect(res.data.caseCount).toBe(3);

    const caseInserts = ops.filter((o) => o.table === "test_cases" && o.op === "insert");
    expect(caseInserts).toHaveLength(1);
    const rows = caseInserts[0]?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe("draft");
      expect(r.suite_id).toBe(SUITE);
    }
    expect(rows[2]?.tags as string[]).toContain("security");
    expect(rows[2]?.tags as string[]).toContain("Checkout");

    const updates = ops.filter((o) => o.table === "test_plans" && o.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toMatchObject({ status: "converted", suite_id: SUITE });
  });

  it("refuses to convert an already-converted plan", async () => {
    const { ops, from } = mockDb({
      test_plans: { data: draftPlanRow("converted"), error: null },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });

    const res = await convertTestPlan(WS, PROJECT, PLAN, { suiteName: "Another suite" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("This plan was already converted to a suite.");
    expect(ops.filter((o) => o.table === "suites" && o.op === "insert")).toHaveLength(0);
  });

  it("removes the new suite when case insertion fails", async () => {
    const { ops, from } = mockDb({
      test_plans: { data: draftPlanRow("draft"), error: null },
      suites: { data: { id: SUITE }, error: null },
      test_cases: { data: null, error: new Error("insert failed") },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });

    const res = await convertTestPlan(WS, PROJECT, PLAN, { suiteName: "Checkout suite" });
    expect(res.ok).toBe(false);
    const deletes = ops.filter((o) => o.table === "suites" && o.op === "delete");
    expect(deletes).toHaveLength(1);
  });

  it("returns NOT FOUND for a plan outside the project", async () => {
    const { from } = mockDb({ test_plans: { data: null, error: null } });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });

    const res = await convertTestPlan(WS, PROJECT, PLAN, { suiteName: "Valid name" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Test plan not found.");
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await convertTestPlan(WS, PROJECT, PLAN, { suiteName: "Valid name" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("You don't have access to this workspace.");
  });
});

describe("listTestPlans / deleteTestPlan", () => {
  it("lists stored plans", async () => {
    const { from } = mockDb({ test_plans: { data: [draftPlanRow()], error: null } });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });
    const res = await listTestPlans(WS, PROJECT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.name).toBe("Checkout plan");
  });

  it("deletes an existing plan", async () => {
    const { ops, from } = mockDb({
      test_plans: { data: draftPlanRow(), error: null },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });
    const res = await deleteTestPlan(WS, PROJECT, PLAN);
    expect(res.ok).toBe(true);
    expect(ops.filter((o) => o.table === "test_plans" && o.op === "delete")).toHaveLength(1);
  });

  it("cannot delete a missing plan", async () => {
    const { from } = mockDb({ test_plans: { data: null, error: null } });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: { from }, userId: "user-1" });
    const res = await deleteTestPlan(WS, PROJECT, PLAN);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Test plan not found.");
  });
});
