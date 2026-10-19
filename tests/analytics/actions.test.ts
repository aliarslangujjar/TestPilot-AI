/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAnalytics } from "@/lib/analytics/actions";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const { fromMock, getUserMock, createClientMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

function mockQuery(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "not", "gte", "head", "maybeSingle"]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown) => void) =>
    resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    });
  return q;
}

function setup(
  tableResults: Record<string, { data?: unknown; error?: unknown; count?: number | null }>,
) {
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
  const queries: Array<{ table: string; q: ReturnType<typeof mockQuery> }> = [];
  fromMock.mockImplementation((table: string) => {
    const q = mockQuery(
      table === "memberships"
        ? { data: { role: "member" }, error: null }
        : (tableResults[table] ?? { data: [], error: null, count: 0 }),
    );
    queries.push({ table, q });
    return q;
  });
  return queries;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAnalytics", () => {
  it("denies non-members without touching data tables", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
    fromMock.mockImplementation((table: string) =>
      table === "memberships"
        ? mockQuery({ data: null, error: null })
        : mockQuery({ data: [], error: null }),
    );

    const result = await getAnalytics(WS_ID, 15);
    expect(result).toEqual({
      ok: false,
      error: "You don't have access to this workspace.",
    });
    expect(fromMock).toHaveBeenCalledWith("memberships");
    expect(fromMock.mock.calls.filter((c) => c[0] !== "memberships")).toHaveLength(0);
  });

  it("rejects invalid ranges before any database access", async () => {
    setup({});
    const result = await getAnalytics(WS_ID, 99);
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("aggregates totals and per-day series from real rows", async () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const rows = [
      { outcome: "pass", executed_at: today },
      { outcome: "pass", executed_at: today },
      { outcome: "fail", executed_at: today },
      { outcome: "blocked", executed_at: yesterday },
      { outcome: "skipped", executed_at: yesterday },
    ];
    getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
    fromMock.mockImplementation((table: string) => {
      if (table === "memberships") return mockQuery({ data: { role: "member" }, error: null });
      if (table === "test_cases") {
        // First call is the total count, second is the draft count.
        const calls = fromMock.mock.calls.filter((c) => c[0] === "test_cases").length;
        return mockQuery(calls <= 1 ? { count: 10 } : { count: 4 });
      }
      const rest: Record<string, { count?: number | null; data?: unknown }> = {
        projects: { count: 2 },
        suites: { count: 3 },
        test_runs: { count: 4 },
        run_results: { data: rows },
      };
      return mockQuery(rest[table] ?? { data: [], count: 0 });
    });

    const result = await getAnalytics(WS_ID, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(result.data.totals).toEqual({
      projects: 2,
      suites: 3,
      testCases: 10,
      draftCases: 4,
      runs: 4,
      executions: 5,
      pass: 2,
      fail: 1,
      blocked: 1,
      skipped: 1,
      passRate: 40,
    });
    expect(result.data.daily).toHaveLength(7);

    const todayKey = new Date().toISOString().slice(0, 10);
    const todayPoint = result.data.daily.find((d) => d.date === todayKey)!;
    expect(todayPoint.pass).toBe(2);
    expect(todayPoint.fail).toBe(1);
    expect(todayPoint.total).toBe(3);
    expect(todayPoint.passRate).toBe(67);

    // Days with no executions carry zero counts and a null pass rate.
    const empty = result.data.daily.filter((d) => d.total === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const d of empty) expect(d.passRate).toBeNull();
  });

  it("scopes every query to the workspace", async () => {
    const queries = setup({
      projects: { count: 0 },
      suites: { count: 0 },
      test_cases: { count: 0 },
      test_runs: { count: 0 },
      run_results: { data: [] },
    });

    await getAnalytics(WS_ID, 7);
    for (const { table, q } of queries) {
      if (table === "memberships") continue;
      const calls = (q.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
      expect(calls).toContainEqual(["workspace_id", WS_ID]);
    }
  });
});
