/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAutomatedRun, refreshAutomatedRun } from "@/lib/test-runs/automated";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CASE1 = "33333333-3333-4333-8333-333333333333";
const RUN = "55555555-5555-4555-8555-555555555555";
const JOB1 = "66666666-6666-4666-8666-666666666666";

const { requireWorkspaceClientMock, reserveMock, releaseMock, meterMock, countersMock } =
  vi.hoisted(() => ({
    requireWorkspaceClientMock: vi.fn(),
    reserveMock: vi.fn(),
    releaseMock: vi.fn(),
    meterMock: vi.fn(),
    countersMock: vi.fn(),
  }));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/usage/usage", () => ({
  reserveUsage: (...args: unknown[]) => reserveMock(...args),
  releaseUsage: (...args: unknown[]) => releaseMock(...args),
  meterUsage: (...args: unknown[]) => meterMock(...args),
  getUsageCounters: (...args: unknown[]) => countersMock(...args),
  getUsageHistory: vi.fn(async () => []),
  syncStorageUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: vi.fn() }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface RecordedOp {
  table: string;
  op: string;
  payload?: unknown;
}

function mockDb(presets: Record<string, { data: unknown; error: unknown }>) {
  const ops: RecordedOp[] = [];
  function chain(table: string) {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) q[m] = vi.fn(() => q);
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
    q.then = (resolve: (value: unknown) => void) =>
      resolve(presets[table] ?? { data: null, error: null });
    return q;
  }
  return { ops, from: vi.fn((t: string) => chain(t)) };
}

const PLAN = {
  version: "1",
  name: "Login flow",
  baseUrl: "https://app.example.com",
  allowedHosts: ["app.example.com"],
  steps: [
    { action: "goto", url: "/login" },
    { action: "assertUrl", expected: "/dashboard" },
  ],
};

const CASE_ROW = {
  id: CASE1,
  title: "Login flow",
  description: null,
  preconditions: null,
  steps: [{ action: "Open login", expected: "Login page opens" }],
  expected_results: null,
  priority: "high",
  tags: [],
  status: "active",
};

const EVIDENCE = {
  status: "succeeded",
  steps: [
    { index: 0, action: "goto", ok: true, durationMs: 100 },
    { index: 1, action: "assertUrl", ok: true, durationMs: 50 },
  ],
  artifacts: [],
  startedAt: "2026-10-19T21:00:00.000Z",
  finishedAt: "2026-10-19T21:01:30.000Z", // 90 seconds
};

function basePresets(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  return {
    test_cases: { data: [CASE_ROW], error: null },
    browser_plans: { data: [{ test_case_id: CASE1, plan: PLAN }], error: null },
    test_runs: { data: { id: RUN }, error: null },
    run_results: { data: null, error: null },
    browser_jobs: { data: [{ id: JOB1, test_case_id: CASE1 }], error: null },
    ...overrides,
  };
}

const ZERO_USAGE = { aiCalls: 0, browserRuns: 0, executionSeconds: 0, storageBytes: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  reserveMock.mockResolvedValue(true);
  countersMock.mockResolvedValue({ ...ZERO_USAGE });
});

const INPUT = { name: "Nightly", testCaseIds: [CASE1] };

describe("createAutomatedRun — quota enforcement", () => {
  it("rejects gracefully when the browser-run quota is exhausted, and cleans up", async () => {
    const db = mockDb(basePresets());
    requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });
    reserveMock.mockResolvedValue(false);

    const res = await createAutomatedRun(WS, PROJECT, INPUT);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/browser runs for this period/);
    // The provisional run row was removed; no jobs were enqueued.
    expect(db.ops.some((o) => o.table === "test_runs" && o.op === "delete")).toBe(true);
    expect(db.ops.filter((o) => o.table === "browser_jobs")).toHaveLength(0);
    expect(reserveMock).toHaveBeenCalledWith(WS, { browserRuns: 1 });
  });

  it("rejects before creating anything when the execution budget is already used up", async () => {
    const db = mockDb(basePresets());
    requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });
    countersMock.mockResolvedValue({ ...ZERO_USAGE, executionSeconds: 3600 });

    const res = await createAutomatedRun(WS, PROJECT, INPUT);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/execution time for this period/);
    expect(db.ops.filter((o) => o.table === "test_runs")).toHaveLength(0);
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it("creates the run when quota is available and does not release", async () => {
    const db = mockDb(basePresets());
    requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });
    const res = await createAutomatedRun(WS, PROJECT, INPUT);
    expect(res.ok).toBe(true);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("releases the reservation when job creation fails downstream", async () => {
    const db = mockDb(
      basePresets({ browser_jobs: { data: null, error: { message: "insert failed" } } }),
    );
    requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });
    const res = await createAutomatedRun(WS, PROJECT, INPUT);
    expect(res.ok).toBe(false);
    expect(releaseMock).toHaveBeenCalledWith(WS, { browserRuns: 1 });
  });
});

describe("refreshAutomatedRun — duration metering", () => {
  it("meters execution seconds exactly once, at the terminal transition", async () => {
    const resultRow = {
      id: "res-1",
      run_id: RUN,
      workspace_id: WS,
      test_case_id: CASE1,
      snapshot: {
        title: "Login flow",
        description: null,
        preconditions: null,
        steps: [],
        expectedResults: null,
        priority: "high",
        tags: [],
        caseStatus: "active",
      },
      outcome: "unexecuted",
      browser_job_id: JOB1,
      execution_status: "queued",
      artifacts: [],
      notes: null,
      executed_by: null,
      executed_at: null,
      created_at: "2026-10-19T20:00:00.000Z",
      updated_at: "2026-10-19T20:00:00.000Z",
    };
    const jobRow = {
      id: JOB1,
      status: "succeeded",
      failure_kind: null,
      cancel_requested: false,
      plan: { steps: PLAN.steps },
      result: EVIDENCE,
    };
    const db = mockDb({
      test_runs: {
        data: { id: RUN, source: "automated", status: "in_progress", execution_status: "queued" },
        error: null,
      },
      run_results: { data: [resultRow], error: null },
      browser_jobs: { data: [jobRow], error: null },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });

    const res = await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    expect(meterMock).toHaveBeenCalledTimes(1);
    expect(meterMock).toHaveBeenCalledWith(WS, { executionSeconds: 90 });
  });
});
