/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareAutomatedRuns } from "@/lib/run-details/compare";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const RUN_A = "55555555-5555-4555-8555-555555555555";
const RUN_B = "66666666-6666-4666-8666-666666666666";
const CASE1 = "33333333-3333-4333-8333-333333333333";
const CASE2 = "44444444-4444-4333-8444-444444444444";
const CASE3 = "77777777-7777-4777-8777-777777777777";
const CASE4 = "88888888-8888-4888-8888-888888888888";
const CASE5 = "99999999-9999-4999-8999-999999999999";
const CASE6 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_A1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_B1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const { requireWorkspaceClientMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function mockDb(presets: Record<string, unknown[]>) {
  function chain(table: string) {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.in = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.limit = vi.fn(() => q);
    q.maybeSingle = vi.fn(() => q);
    q.then = (resolve: (value: unknown) => void) =>
      resolve({ data: presets[table] ?? [], error: null });
    return q;
  }
  return { from: vi.fn((t: string) => chain(t)) };
}

function result(
  runId: string,
  caseId: string,
  title: string,
  status: string,
  jobId: string | null = null,
) {
  return {
    run_id: runId,
    test_case_id: caseId,
    snapshot: { title },
    execution_status: status,
    browser_job_id: jobId,
  };
}

beforeEach(() => {
  requireWorkspaceClientMock.mockReset();
  requireWorkspaceClientMock.mockResolvedValue({
    supabase: mockDb({
      test_runs: [
        { id: RUN_A, name: "Base", source: "automated" },
        { id: RUN_B, name: "Next", source: "automated" },
      ],
      run_results: [
        result(RUN_A, CASE1, "Case 1", "failed", JOB_A1),
        result(RUN_A, CASE2, "Case 2", "passed"),
        result(RUN_A, CASE3, "Case 3", "failed"),
        result(RUN_A, CASE4, "Case 4", "passed"),
        result(RUN_A, CASE6, "Case 6", "passed"),
        result(RUN_B, CASE1, "Case 1", "passed", JOB_B1),
        result(RUN_B, CASE2, "Case 2", "failed"),
        result(RUN_B, CASE3, "Case 3", "timed_out"),
        result(RUN_B, CASE4, "Case 4", "passed"),
        result(RUN_B, CASE5, "Case 5", "passed"),
      ],
      browser_jobs: [
        {
          id: JOB_A1,
          result: {
            status: "failed",
            steps: [],
            artifacts: [],
            startedAt: "2026-10-19T00:00:00.000Z",
            finishedAt: "2026-10-19T00:00:04.000Z",
          },
        },
        {
          id: JOB_B1,
          result: {
            status: "succeeded",
            steps: [],
            artifacts: [],
            startedAt: "2026-10-19T00:00:00.000Z",
            finishedAt: "2026-10-19T00:00:01.500Z",
          },
        },
      ],
    }),
  });
});

describe("compareAutomatedRuns", () => {
  it("classifies fixed, regressed, still-failing, unchanged, added, removed", async () => {
    const res = await compareAutomatedRuns(WS, PROJECT, RUN_A, RUN_B);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byTitle = new Map(res.data.cases.map((c) => [c.caseTitle, c]));
    expect(byTitle.get("Case 1")?.change).toBe("fixed");
    expect(byTitle.get("Case 2")?.change).toBe("regressed");
    expect(byTitle.get("Case 3")?.change).toBe("still_failing");
    expect(byTitle.get("Case 4")?.change).toBe("unchanged");
    expect(byTitle.get("Case 5")?.change).toBe("added");
    expect(byTitle.get("Case 6")?.change).toBe("removed");
    expect(res.data.summary).toMatchObject({ fixed: 1, regressed: 1, still_failing: 1 });
  });

  it("reports negative duration deltas when the other run was faster", async () => {
    const res = await compareAutomatedRuns(WS, PROJECT, RUN_A, RUN_B);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c1 = res.data.cases.find((c) => c.caseTitle === "Case 1");
    expect(c1?.baseDurationMs).toBe(4000);
    expect(c1?.otherDurationMs).toBe(1500);
    expect(c1?.durationDeltaMs).toBe(-2500);
  });

  it("refuses comparing a run to itself", async () => {
    const res = await compareAutomatedRuns(WS, PROJECT, RUN_A, RUN_A);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Pick two different runs to compare.");
  });

  it("returns NOT FOUND when a run is outside the project", async () => {
    requireWorkspaceClientMock.mockResolvedValue({
      supabase: mockDb({ test_runs: [{ id: RUN_A, name: "Base", source: "automated" }] }),
    });
    const res = await compareAutomatedRuns(WS, PROJECT, RUN_A, RUN_B);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Test run not found.");
  });
});
