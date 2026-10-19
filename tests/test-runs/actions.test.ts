/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeRun,
  createRun,
  getRun,
  listRuns,
  reopenRun,
  setResultOutcome,
} from "@/lib/test-runs/actions";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SUITE_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "66666666-6666-4666-8666-666666666666";
const CASE_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "77777777-7777-4777-8777-777777777777";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const { fromMock, getUserMock, createClientMock, revalidateMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  createClientMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidateMock(...args),
}));

function mockQuery(result: { data?: unknown; error?: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "in",
    "order",
    "insert",
    "update",
    "delete",
    "single",
    "maybeSingle",
  ]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown) => void) =>
    resolve({ data: result.data ?? null, error: result.error ?? null });
  return q;
}

const CASE_ROW = {
  id: CASE_ID,
  title: "Login works",
  description: "Covers login.",
  preconditions: "User exists.",
  steps: [{ action: "Enter credentials", expected: "Dashboard opens" }],
  expected_results: "Logged in.",
  priority: "high",
  tags: ["smoke"],
  status: "active",
};

const RUN_ROW = {
  id: RUN_ID,
  workspace_id: WS_ID,
  project_id: PROJECT_ID,
  suite_id: SUITE_ID,
  name: "Sprint 1",
  source: "manual",
  status: "in_progress",
  notes: null,
  created_by: USER_ID,
  created_at: "2026-10-18T10:00:00.000Z",
  updated_at: "2026-10-18T10:00:00.000Z",
  completed_at: null,
};

type TableResult = { data?: unknown; error?: unknown };

function memberClient(tableResults: Record<string, TableResult | TableResult[]>) {
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
  const queries: Array<{ table: string; q: ReturnType<typeof mockQuery> }> = [];
  fromMock.mockImplementation((table: string) => {
    let res: TableResult;
    if (table === "memberships") {
      res = { data: { role: "member" }, error: null };
    } else {
      const entry = tableResults[table];
      if (Array.isArray(entry)) res = entry.shift() ?? { data: [], error: null };
      else res = entry ?? { data: [], error: null };
    }
    const q = mockQuery(res);
    queries.push({ table, q });
    return q;
  });
  return queries;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("access control", () => {
  it("denies non-members without touching data tables", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
    fromMock.mockImplementation((table: string) =>
      table === "memberships"
        ? mockQuery({ data: null, error: null })
        : mockQuery({ data: [], error: null }),
    );

    for (const call of [
      () => listRuns(WS_ID, PROJECT_ID, {}),
      () => getRun(WS_ID, PROJECT_ID, RUN_ID),
      () => createRun(WS_ID, PROJECT_ID, { name: "Sprint 1", testCaseIds: [CASE_ID] }),
      () => setResultOutcome(WS_ID, PROJECT_ID, RUN_ID, RESULT_ID, { outcome: "pass" }),
      () => completeRun(WS_ID, PROJECT_ID, RUN_ID),
      () => reopenRun(WS_ID, PROJECT_ID, RUN_ID),
    ]) {
      const result = await call();
      expect(result).toEqual({
        ok: false,
        error: "You don't have access to this workspace.",
      });
    }
    expect(fromMock).toHaveBeenCalledWith("memberships");
    const tables = fromMock.mock.calls.map((c) => c[0]);
    expect(tables.filter((t) => t !== "memberships")).toHaveLength(0);
  });

  it("rejects cross-workspace runs as not found", async () => {
    memberClient({
      projects: { data: { id: PROJECT_ID }, error: null },
      test_runs: { data: null, error: null },
    });
    // getScopedRun filters by workspace_id: a run from another workspace
    // never matches, so it reads as not found.
    const result = await getRun(OTHER_WS, PROJECT_ID, RUN_ID);
    expect(result).toEqual({ ok: false, error: "Test run not found." });
    const runCalls = fromMock.mock.calls.filter((c) => c[0] === "test_runs");
    expect(runCalls.length).toBeGreaterThan(0);
  });
});

describe("createRun", () => {
  it("validates before any database access", async () => {
    memberClient({});
    const result = await createRun(WS_ID, PROJECT_ID, { name: "x", testCaseIds: [] });
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("snapshots case data at creation and starts all results unexecuted", async () => {
    const queries = memberClient({
      projects: { data: { id: PROJECT_ID }, error: null },
      suites: { data: { id: SUITE_ID }, error: null },
      test_cases: { data: [CASE_ROW], error: null },
      test_runs: { data: RUN_ROW, error: null },
      run_results: { data: null, error: null },
    });

    const result = await createRun(WS_ID, PROJECT_ID, {
      name: "Sprint 1",
      suiteId: SUITE_ID,
      testCaseIds: [CASE_ID],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const resultsInsert = queries.find((c) => c.table === "run_results")!;
    const payload = (resultsInsert.q.insert as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Array<{
      run_id: string;
      workspace_id: string;
      test_case_id: string;
      snapshot: Record<string, unknown>;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]!.run_id).toBe(RUN_ID);
    expect(payload[0]!.workspace_id).toBe(WS_ID);
    expect(payload[0]!.test_case_id).toBe(CASE_ID);
    // The snapshot freezes the case as it looked right now.
    expect(payload[0]!.snapshot).toEqual({
      title: "Login works",
      description: "Covers login.",
      preconditions: "User exists.",
      steps: [{ action: "Enter credentials", expected: "Dashboard opens" }],
      expectedResults: "Logged in.",
      priority: "high",
      tags: ["smoke"],
      caseStatus: "active",
    });

    expect(result.data.summary).toEqual({
      total: 1,
      unexecuted: 1,
      pass: 0,
      fail: 0,
      blocked: 0,
      skipped: 0,
    });
    expect(result.data.source).toBe("manual");
  });

  it("rejects unknown test cases", async () => {
    memberClient({
      projects: { data: { id: PROJECT_ID }, error: null },
      test_cases: { data: [], error: null },
    });
    const result = await createRun(WS_ID, PROJECT_ID, {
      name: "Sprint 1",
      testCaseIds: [CASE_ID],
    });
    expect(result).toEqual({ ok: false, error: "Some test cases were not found." });
  });

  it("rejects suites from another project", async () => {
    memberClient({
      projects: { data: { id: PROJECT_ID }, error: null },
      suites: { data: null, error: null },
    });
    const result = await createRun(WS_ID, PROJECT_ID, {
      name: "Sprint 1",
      suiteId: SUITE_ID,
      testCaseIds: [CASE_ID],
    });
    expect(result).toEqual({ ok: false, error: "Suite not found." });
  });
});

describe("result transitions", () => {
  const RESULT_ROW = {
    id: RESULT_ID,
    run_id: RUN_ID,
    workspace_id: WS_ID,
    test_case_id: CASE_ID,
    snapshot: { title: "Login works" },
    outcome: "unexecuted",
    notes: null,
    executed_by: null,
    executed_at: null,
    created_at: "2026-10-18T10:00:00.000Z",
    updated_at: "2026-10-18T10:00:00.000Z",
  };

  it("records the outcome with executor and timestamp", async () => {
    const queries = memberClient({
      test_runs: { data: RUN_ROW, error: null },
      run_results: { data: { ...RESULT_ROW, outcome: "pass" }, error: null },
    });

    const result = await setResultOutcome(WS_ID, PROJECT_ID, RUN_ID, RESULT_ID, {
      outcome: "pass",
      notes: "Worked first try.",
    });

    expect(result.ok).toBe(true);
    const updateQuery = queries.filter((c) => c.table === "run_results").pop()!;
    const updateArg = (updateQuery.q.update as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(updateArg.outcome).toBe("pass");
    expect(updateArg.notes).toBe("Worked first try.");
    expect(updateArg.executed_by).toBe(USER_ID);
    expect(typeof updateArg.executed_at).toBe("string");
  });

  it("refuses to change results on a completed run", async () => {
    const queries = memberClient({
      test_runs: { data: { ...RUN_ROW, status: "completed" }, error: null },
    });

    const result = await setResultOutcome(WS_ID, PROJECT_ID, RUN_ID, RESULT_ID, {
      outcome: "pass",
    });

    expect(result).toEqual({
      ok: false,
      error: "This run is completed. Reopen it to change results.",
    });
    expect(
      queries.some((c) => {
        const update = c.q.update as ReturnType<typeof vi.fn>;
        return update.mock.calls.length > 0;
      }),
    ).toBe(false);
  });
});

describe("run lifecycle", () => {
  it("completes an in-progress run", async () => {
    const completed = { ...RUN_ROW, status: "completed" };
    memberClient({
      test_runs: [
        { data: RUN_ROW, error: null },
        { data: completed, error: null },
        { data: completed, error: null },
      ],
      run_results: { data: [], error: null },
    });

    const result = await completeRun(WS_ID, PROJECT_ID, RUN_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.status).toBe("completed");
  });

  it("rejects completing an already-completed run", async () => {
    const queries = memberClient({
      test_runs: { data: { ...RUN_ROW, status: "completed" }, error: null },
    });

    const result = await completeRun(WS_ID, PROJECT_ID, RUN_ID);
    expect(result).toEqual({
      ok: false,
      error: "This run cannot move to that state.",
    });
    expect(
      queries.some((c) => (c.q.update as ReturnType<typeof vi.fn>).mock.calls.length > 0),
    ).toBe(false);
  });

  it("reopens a completed run", async () => {
    const completed = { ...RUN_ROW, status: "completed" };
    memberClient({
      test_runs: [
        { data: completed, error: null },
        { data: RUN_ROW, error: null },
        { data: RUN_ROW, error: null },
      ],
      run_results: { data: [], error: null },
    });

    const result = await reopenRun(WS_ID, PROJECT_ID, RUN_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.status).toBe("in_progress");
  });

  it("rejects reopening an in-progress run", async () => {
    memberClient({
      test_runs: { data: RUN_ROW, error: null },
    });

    const result = await reopenRun(WS_ID, PROJECT_ID, RUN_ID);
    expect(result).toEqual({
      ok: false,
      error: "This run cannot move to that state.",
    });
  });
});

describe("summaries", () => {
  it("aggregates outcome counts per run in listRuns", async () => {
    memberClient({
      projects: { data: { id: PROJECT_ID }, error: null },
      test_runs: { data: [RUN_ROW], error: null },
      run_results: {
        data: [
          { run_id: RUN_ID, outcome: "pass" },
          { run_id: RUN_ID, outcome: "fail" },
          { run_id: RUN_ID, outcome: "unexecuted" },
        ],
        error: null,
      },
    });

    const result = await listRuns(WS_ID, PROJECT_ID, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data[0]!.summary).toEqual({
      total: 3,
      unexecuted: 1,
      pass: 1,
      fail: 1,
      blocked: 0,
      skipped: 0,
    });
  });

  it("scopes every query to the workspace and project", async () => {
    const queries = memberClient({
      projects: { data: { id: PROJECT_ID }, error: null },
      test_runs: { data: [], error: null },
      run_results: { data: [], error: null },
    });

    await listRuns(WS_ID, PROJECT_ID, {});
    for (const { q } of queries) {
      const eq = q.eq as ReturnType<typeof vi.fn>;
      const calls = eq.mock.calls as Array<[string, unknown]>;
      const hasWorkspaceScope = calls.some(([col, val]) => col === "workspace_id" && val === WS_ID);
      // The memberships check is the authorization itself.
      if (q !== queries[0]!.q) expect(hasWorkspaceScope).toBe(true);
    }
    const runQuery = queries.find((c) => c.table === "test_runs")!;
    expect((runQuery.q.eq as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      "project_id",
      PROJECT_ID,
    ]);
  });
});
