/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOverviewStats } from "@/lib/overview/actions";

const WS_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

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
  for (const m of ["select", "eq", "order", "limit", "single", "maybeSingle"]) {
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

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
  fromMock.mockImplementation((table: string) =>
    table === "memberships"
      ? mockQuery({ data: { role: "member" }, error: null })
      : mockQuery({ data: [], error: null }),
  );
});

describe("getOverviewStats", () => {
  it("denies non-members without touching data tables", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "memberships"
        ? mockQuery({ data: null, error: null })
        : mockQuery({ data: [], error: null }),
    );
    const result = await getOverviewStats(WS_ID);
    expect(result).toEqual({
      ok: false,
      error: "You don't have access to this workspace.",
    });
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("memberships");
  });

  it("returns workspace-scoped counts and recent cases", async () => {
    const recentRow = {
      id: "55555555-5555-5555-5555-555555555555",
      title: "Login works",
      status: "active",
      priority: "high",
      updated_at: "2026-10-18T12:00:00.000Z",
      suites: { name: "Smoke tests" },
    };
    const results = [
      { count: 2 },
      { count: 3 },
      { count: 10 },
      { count: 4 },
      { count: 6 },
      { data: [recentRow] },
    ];
    let i = 0;
    fromMock.mockImplementation((table: string) =>
      table === "memberships"
        ? mockQuery({ data: { role: "member" }, error: null })
        : mockQuery(results[i++] ?? {}),
    );

    const result = await getOverviewStats(WS_ID);
    expect(result).toEqual({
      ok: true,
      data: {
        projects: 2,
        suites: 3,
        testCases: 10,
        draftCases: 4,
        activeCases: 6,
        recentCases: [
          {
            id: recentRow.id,
            title: "Login works",
            status: "active",
            priority: "high",
            updatedAt: recentRow.updated_at,
            suiteName: "Smoke tests",
          },
        ],
      },
    });
  });

  it("scopes every aggregate query to the workspace", async () => {
    const queries: ReturnType<typeof mockQuery>[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "memberships") return mockQuery({ data: { role: "member" }, error: null });
      const q = mockQuery({ count: 0 });
      queries.push(q);
      return q;
    });
    await getOverviewStats(WS_ID);
    expect(queries.length).toBe(6);
    for (const q of queries) {
      expect((q.eq as ReturnType<typeof vi.fn>).mock.calls).toContainEqual(["workspace_id", WS_ID]);
    }
  });

  it("returns an error when a query fails", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "memberships"
        ? mockQuery({ data: { role: "member" }, error: null })
        : mockQuery({ error: { message: "boom" } }),
    );
    const result = await getOverviewStats(WS_ID);
    expect(result.ok).toBe(false);
  });
});
