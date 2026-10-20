/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelAutomatedRun,
  createAutomatedRun,
  getBrowserPlan,
  refreshAutomatedRun,
  saveBrowserPlan,
} from "@/lib/test-runs/automated";
import { validateWorkerEvidence } from "@/lib/test-runs/evidence";
import { rollupExecutionStatus } from "@/lib/test-runs/rollup";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CASE1 = "33333333-3333-4333-8333-333333333333";
const CASE2 = "44444444-4444-4333-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const JOB1 = "66666666-6666-4666-8666-666666666666";
const JOB2 = "77777777-7777-4777-8777-777777777777";

const { requireWorkspaceClientMock, createAdminClientMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClientMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface RecordedOp {
  table: string;
  op: "insert" | "upsert" | "update" | "delete";
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

/** Thenable chain mock that records writes and serves per-table presets. */
function mockDb(presets: Record<string, unknown>) {
  const ops: RecordedOp[] = [];
  function chain(table: string) {
    const filters: Array<[string, unknown]> = [];
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn((c: string, v: unknown) => {
      filters.push([c, v]);
      return q;
    });
    q.in = vi.fn((c: string, v: unknown) => {
      filters.push([c, v]);
      return q;
    });
    q.order = vi.fn(() => q);
    q.limit = vi.fn(() => q);
    q.maybeSingle = vi.fn(() => q);
    q.single = vi.fn(() => q);
    q.insert = vi.fn((rows: unknown) => {
      ops.push({ table, op: "insert", payload: rows, filters });
      return q;
    });
    q.upsert = vi.fn((rows: unknown) => {
      ops.push({ table, op: "upsert", payload: rows, filters });
      return q;
    });
    q.update = vi.fn((patch: unknown) => {
      ops.push({ table, op: "update", payload: patch, filters });
      return q;
    });
    q.delete = vi.fn(() => {
      ops.push({ table, op: "delete", filters });
      return q;
    });
    q.then = (resolve: (value: unknown) => void) =>
      resolve({ data: presets[table] ?? null, error: null });
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

const SNAPSHOT = {
  title: "Login flow",
  description: null,
  preconditions: null,
  steps: [{ action: "Open login", expected: "Login page opens" }],
  expectedResults: null,
  priority: "high",
  tags: [],
  caseStatus: "active",
};

const CASE_ROW = (id: string) => ({
  id,
  title: id === CASE1 ? "Login flow" : "Checkout flow",
  description: null,
  preconditions: null,
  steps: [{ action: "Open login", expected: "Login page opens" }],
  expected_results: null,
  priority: "high",
  tags: [],
  status: "active",
});

const EVIDENCE = {
  status: "succeeded",
  steps: [
    { index: 0, action: "goto", ok: true, durationMs: 100 },
    { index: 1, action: "assertUrl", ok: true, durationMs: 50 },
  ],
  artifacts: ["ws/run/step-1.png"],
  startedAt: "2026-10-19T21:00:00.000Z",
  finishedAt: "2026-10-19T21:01:00.000Z",
};

const jobRow = (over: Record<string, unknown> = {}) => ({
  id: JOB1,
  status: "succeeded",
  failure_kind: null,
  cancel_requested: false,
  plan: { steps: PLAN.steps },
  result: EVIDENCE,
  ...over,
});

const resultRow = (over: Record<string, unknown> = {}) => ({
  id: "res-1",
  run_id: RUN,
  workspace_id: WS,
  test_case_id: CASE1,
  snapshot: SNAPSHOT,
  outcome: "unexecuted",
  browser_job_id: JOB1,
  execution_status: "queued",
  artifacts: [],
  notes: null,
  executed_by: null,
  executed_at: null,
  created_at: "2026-10-19T20:00:00.000Z",
  updated_at: "2026-10-19T20:00:00.000Z",
  ...over,
});

const automatedRunRow = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  source: "automated",
  status: "in_progress",
  execution_status: "queued",
  ...over,
});

function memberClient(db: ReturnType<typeof mockDb>) {
  requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockImplementation(() => mockDb({}));
});

// ---------------------------------------------------------------------------
// Evidence gate
// ---------------------------------------------------------------------------

describe("validateWorkerEvidence", () => {
  it("passes only on succeeded jobs with full, all-ok step evidence", () => {
    expect(validateWorkerEvidence({ jobStatus: "succeeded", result: EVIDENCE, planSteps: 2 })).toBe(
      true,
    );
  });

  it("never passes when the job is not succeeded", () => {
    expect(validateWorkerEvidence({ jobStatus: "failed", result: EVIDENCE, planSteps: 2 })).toBe(
      false,
    );
  });

  it("never passes on malformed or missing results", () => {
    expect(validateWorkerEvidence({ jobStatus: "succeeded", result: null, planSteps: 2 })).toBe(
      false,
    );
    expect(
      validateWorkerEvidence({ jobStatus: "succeeded", result: { nope: true }, planSteps: 2 }),
    ).toBe(false);
  });

  it("never passes when step counts mismatch the plan", () => {
    expect(validateWorkerEvidence({ jobStatus: "succeeded", result: EVIDENCE, planSteps: 3 })).toBe(
      false,
    );
  });

  it("never passes when any step failed", () => {
    const bad = {
      ...EVIDENCE,
      steps: [{ index: 0, action: "goto", ok: false, durationMs: 1 }],
    };
    expect(validateWorkerEvidence({ jobStatus: "succeeded", result: bad, planSteps: 1 })).toBe(
      false,
    );
  });
});

describe("rollupExecutionStatus", () => {
  it("applies running > queued > failed > timed_out > cancelled > passed", () => {
    expect(rollupExecutionStatus(["passed", "running"])).toBe("running");
    expect(rollupExecutionStatus(["passed", "queued"])).toBe("queued");
    expect(rollupExecutionStatus(["passed", "failed"])).toBe("failed");
    expect(rollupExecutionStatus(["passed", "timed_out"])).toBe("timed_out");
    expect(rollupExecutionStatus(["passed", "cancelled"])).toBe("cancelled");
    expect(rollupExecutionStatus(["passed", "passed"])).toBe("passed");
    expect(rollupExecutionStatus(["cancelled", "cancelled"])).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Browser plans
// ---------------------------------------------------------------------------

describe("saveBrowserPlan", () => {
  it("upserts a validated plan for the case", async () => {
    const db = mockDb({ test_cases: CASE_ROW(CASE1) });
    memberClient(db);
    const res = await saveBrowserPlan(WS, PROJECT, CASE1, PLAN);
    expect(res.ok).toBe(true);
    const op = db.ops.find((o) => o.table === "browser_plans");
    expect(op?.op).toBe("upsert");
    expect((op?.payload as { test_case_id: string }).test_case_id).toBe(CASE1);
  });

  it("rejects an invalid plan without writing", async () => {
    const db = mockDb({ test_cases: CASE_ROW(CASE1) });
    memberClient(db);
    const res = await saveBrowserPlan(WS, PROJECT, CASE1, { ...PLAN, steps: [{ action: "rm" }] });
    expect(res.ok).toBe(false);
    expect(db.ops).toHaveLength(0);
  });

  it("rejects a case that does not belong to the project", async () => {
    const db = mockDb({ test_cases: null });
    memberClient(db);
    const res = await saveBrowserPlan(WS, PROJECT, CASE1, PLAN);
    expect(res.ok).toBe(false);
    expect(db.ops).toHaveLength(0);
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "not a member"),
    );
    const res = await saveBrowserPlan(WS, PROJECT, CASE1, PLAN);
    expect(res.ok).toBe(false);
  });
});

describe("getBrowserPlan", () => {
  it("returns the stored plan", async () => {
    const db = mockDb({ browser_plans: { plan: PLAN } });
    memberClient(db);
    const res = await getBrowserPlan(WS, CASE1);
    // Zod fills defaults (description, assertUrl match) on the way out.
    expect(res.ok && res.data.plan).toEqual({
      ...PLAN,
      description: "",
      steps: [
        { action: "goto", url: "/login" },
        { action: "assertUrl", expected: "/dashboard", match: "exact" },
      ],
    });
  });

  it("returns null when no plan exists or the stored plan is invalid", async () => {
    memberClient(mockDb({ browser_plans: null }));
    expect((await getBrowserPlan(WS, CASE1)).ok).toBe(true);
    memberClient(mockDb({ browser_plans: { plan: { garbage: true } } }));
    const res = await getBrowserPlan(WS, CASE1);
    expect(res.ok && res.data.plan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Automated run creation
// ---------------------------------------------------------------------------

describe("createAutomatedRun", () => {
  const input = { name: "Nightly smoke", testCaseIds: [CASE1, CASE2] };

  it("creates the run, snapshots, jobs, and links results to jobs", async () => {
    const db = mockDb({
      test_cases: [CASE_ROW(CASE1), CASE_ROW(CASE2)],
      browser_plans: [
        { test_case_id: CASE1, plan: PLAN },
        { test_case_id: CASE2, plan: PLAN },
      ],
      test_runs: { id: RUN },
      browser_jobs: [
        { id: JOB1, test_case_id: CASE1 },
        { id: JOB2, test_case_id: CASE2 },
      ],
    });
    memberClient(db);

    const res = await createAutomatedRun(WS, PROJECT, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.runId).toBe(RUN);
    expect(res.data.executionStatus).toBe("queued");
    expect(res.data.jobCount).toBe(2);

    const runInsert = db.ops.find((o) => o.table === "test_runs" && o.op === "insert");
    expect((runInsert?.payload as { source: string }).source).toBe("automated");
    expect((runInsert?.payload as { execution_status: string }).execution_status).toBe("queued");

    const jobInsert = db.ops.find((o) => o.table === "browser_jobs" && o.op === "insert");
    const rows = jobInsert?.payload as Array<{ idempotency_key: string; run_id: string }>;
    expect(rows).toHaveLength(2);
    // Deterministic keys: no double-enqueue on re-submission.
    expect(rows[0]?.idempotency_key).toBe(`run:${RUN}:case:${CASE1}`);
    expect(rows[1]?.idempotency_key).toBe(`run:${RUN}:case:${CASE2}`);
    expect(rows.every((r) => r.run_id === RUN)).toBe(true);

    const links = db.ops.filter((o) => o.table === "run_results" && o.op === "update");
    expect(links).toHaveLength(2);
    expect(links[0]?.payload).toEqual({ browser_job_id: JOB1 });
  });

  it("refuses the run when a case has no browser plan (no silent drops)", async () => {
    const db = mockDb({
      test_cases: [CASE_ROW(CASE1), CASE_ROW(CASE2)],
      browser_plans: [{ test_case_id: CASE1, plan: PLAN }],
    });
    memberClient(db);
    const res = await createAutomatedRun(WS, PROJECT, input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("no browser plan");
    expect(res.error).toContain("Checkout flow");
    expect(db.ops.find((o) => o.table === "test_runs")).toBeUndefined();
  });

  it("rejects empty or unknown cases before creating anything", async () => {
    memberClient(mockDb({}));
    expect((await createAutomatedRun(WS, PROJECT, { name: "x", testCaseIds: [] })).ok).toBe(false);

    const db = mockDb({ test_cases: [CASE_ROW(CASE1)], browser_plans: [] });
    memberClient(db);
    const res = await createAutomatedRun(WS, PROJECT, input);
    expect(res.ok).toBe(false);
    expect(db.ops.find((o) => o.table === "test_runs")).toBeUndefined();
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "not a member"),
    );
    const res = await createAutomatedRun(WS, PROJECT, input);
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Status refresh (sync)
// ---------------------------------------------------------------------------

describe("refreshAutomatedRun", () => {
  it("marks passed only on valid worker evidence, completes the run, and is idempotent", async () => {
    const db = mockDb({
      test_runs: automatedRunRow(),
      run_results: [
        resultRow(),
        resultRow({ id: "res-2", test_case_id: CASE2, browser_job_id: JOB2 }),
      ],
      browser_jobs: [jobRow(), jobRow({ id: JOB2 })],
    });
    memberClient(db);

    const first = await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.changed).toBe(2);
    expect(first.data.executionStatus).toBe("passed");

    const resultUpdates = db.ops.filter((o) => o.table === "run_results" && o.op === "update");
    expect(resultUpdates).toHaveLength(2);
    expect(resultUpdates[0]?.payload).toMatchObject({
      execution_status: "passed",
      outcome: "pass",
      artifacts: ["ws/run/step-1.png"],
    });

    const runUpdate = db.ops.find((o) => o.table === "test_runs" && o.op === "update");
    expect(runUpdate?.payload).toMatchObject({ execution_status: "passed", status: "completed" });
    expect((runUpdate?.payload as { completed_at?: string }).completed_at).toBeDefined();

    // Duplicate delivery: the same worker state is re-synced against the
    // already-updated rows (what the DB now holds). Nothing may change.
    const syncedResults = [
      resultRow({
        execution_status: "passed",
        outcome: "pass",
        artifacts: ["ws/run/step-1.png"],
        executed_at: "2026-10-19T21:01:00.000Z",
      }),
      resultRow({
        id: "res-2",
        test_case_id: CASE2,
        browser_job_id: JOB2,
        execution_status: "passed",
        outcome: "pass",
        artifacts: ["ws/run/step-1.png"],
        executed_at: "2026-10-19T21:01:00.000Z",
      }),
    ];
    const db2 = mockDb({
      test_runs: automatedRunRow({ status: "completed", execution_status: "passed" }),
      run_results: syncedResults,
      browser_jobs: [jobRow(), jobRow({ id: JOB2 })],
    });
    memberClient(db2);
    const second = await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(second.ok && second.data.changed).toBe(0);
    expect(second.ok && second.data.executionStatus).toBe("passed");
    expect(db2.ops.filter((o) => o.op === "update")).toHaveLength(0);
  });

  it("marks failed when worker evidence is invalid — never passed", async () => {
    const db = mockDb({
      test_runs: automatedRunRow(),
      // Job says succeeded, but the result covers the wrong number of steps.
      run_results: [resultRow()],
      browser_jobs: [jobRow({ result: { ...EVIDENCE, steps: EVIDENCE.steps.slice(0, 1) } })],
    });
    memberClient(db);
    const res = await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    const update = db.ops.find((o) => o.table === "run_results" && o.op === "update");
    expect(update?.payload).toMatchObject({ execution_status: "failed", outcome: "fail" });
    expect(update?.payload).not.toMatchObject({ execution_status: "passed" });
  });

  it("maps exhausted timeouts to timed_out and assertion failures to failed", async () => {
    const db = mockDb({
      test_runs: automatedRunRow(),
      run_results: [
        resultRow(),
        resultRow({ id: "res-2", test_case_id: CASE2, browser_job_id: JOB2 }),
      ],
      browser_jobs: [
        jobRow({ status: "failed", failure_kind: "timeout", result: null }),
        jobRow({ id: JOB2, status: "failed", failure_kind: "assertion", result: null }),
      ],
    });
    memberClient(db);
    await refreshAutomatedRun(WS, PROJECT, RUN);
    const updates = db.ops.filter((o) => o.table === "run_results" && o.op === "update");
    expect(updates[0]?.payload).toMatchObject({ execution_status: "timed_out", outcome: "fail" });
    expect(updates[1]?.payload).toMatchObject({ execution_status: "failed", outcome: "fail" });
    const runUpdate = db.ops.find((o) => o.table === "test_runs" && o.op === "update");
    // failed dominates timed_out in the rollup.
    expect(runUpdate?.payload).toMatchObject({ execution_status: "failed" });
  });

  it("keeps cancelled outcomes unexecuted (honest: the test did not run)", async () => {
    const db = mockDb({
      test_runs: automatedRunRow(),
      run_results: [resultRow()],
      browser_jobs: [jobRow({ status: "cancelled", result: null })],
    });
    memberClient(db);
    await refreshAutomatedRun(WS, PROJECT, RUN);
    const update = db.ops.find((o) => o.table === "run_results" && o.op === "update");
    expect(update?.payload).toMatchObject({ execution_status: "cancelled" });
    expect((update?.payload as { outcome?: string }).outcome).toBeUndefined();
  });

  it("treats queued jobs with a pending cancellation as cancelled", async () => {
    const db = mockDb({
      test_runs: automatedRunRow(),
      run_results: [resultRow()],
      browser_jobs: [jobRow({ status: "queued", cancel_requested: true, result: null })],
    });
    memberClient(db);
    await refreshAutomatedRun(WS, PROJECT, RUN);
    const update = db.ops.find((o) => o.table === "run_results" && o.op === "update");
    expect(update?.payload).toMatchObject({ execution_status: "cancelled" });
  });

  it("survives crash recovery: running -> requeued -> succeeded never goes failed", async () => {
    const running = () => jobRow({ status: "running", result: null });
    const requeued = () => jobRow({ status: "queued", result: null, failure_kind: null });

    // 1. Job is running.
    let db = mockDb({
      test_runs: automatedRunRow(),
      run_results: [resultRow()],
      browser_jobs: [running()],
    });
    memberClient(db);
    await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(
      db.ops.find((o) => o.table === "run_results" && o.op === "update")?.payload,
    ).toMatchObject({ execution_status: "running" });

    // 2. Worker crashed; the lease was reaped and the job is queued again.
    db = mockDb({
      test_runs: automatedRunRow({ execution_status: "running" }),
      run_results: [resultRow({ execution_status: "running" })],
      browser_jobs: [requeued()],
    });
    memberClient(db);
    await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(
      db.ops.find((o) => o.table === "run_results" && o.op === "update")?.payload,
    ).toMatchObject({ execution_status: "queued" });

    // 3. Retry succeeded with valid evidence.
    db = mockDb({
      test_runs: automatedRunRow({ execution_status: "queued" }),
      run_results: [resultRow({ execution_status: "queued" })],
      browser_jobs: [jobRow()],
    });
    memberClient(db);
    const res = await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(res.ok && res.data.executionStatus).toBe("passed");
    expect(
      db.ops.find((o) => o.table === "run_results" && o.op === "update")?.payload,
    ).toMatchObject({ execution_status: "passed", outcome: "pass" });
  });

  it("skips results whose job row is gone instead of inventing a state", async () => {
    const db = mockDb({
      test_runs: automatedRunRow(),
      run_results: [resultRow()],
      browser_jobs: [],
    });
    memberClient(db);
    const res = await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(res.ok && res.data.changed).toBe(0);
  });

  it("rejects manual runs and non-members", async () => {
    memberClient(mockDb({ test_runs: { ...automatedRunRow(), source: "manual" } }));
    const res = await refreshAutomatedRun(WS, PROJECT, RUN);
    expect(res.ok).toBe(false);

    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "not a member"),
    );
    expect((await refreshAutomatedRun(WS, PROJECT, RUN)).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe("cancelAutomatedRun", () => {
  it("flags non-terminal jobs through the admin client, then syncs", async () => {
    const db = mockDb({
      test_runs: automatedRunRow(),
      // Post-flag state: the worker will cancel these before the first step.
      browser_jobs: [
        jobRow({ status: "queued", cancel_requested: true, result: null }),
        jobRow({ id: JOB2, status: "queued", cancel_requested: true, result: null }),
      ],
      run_results: [
        resultRow(),
        resultRow({ id: "res-2", test_case_id: CASE2, browser_job_id: JOB2 }),
      ],
    });
    memberClient(db);

    const res = await cancelAutomatedRun(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.executionStatus).toBe("cancelled");

    // The service-role client set the flag on queued/running jobs only.
    const adminDb = createAdminClientMock.mock.results[0]?.value as ReturnType<typeof mockDb>;
    const flag = adminDb.ops.find((o) => o.table === "browser_jobs" && o.op === "update");
    expect(flag?.payload).toEqual({ cancel_requested: true });
    expect(flag?.filters).toContainEqual(["run_id", RUN]);
    expect(flag?.filters).toContainEqual(["status", ["queued", "running"]]);
  });

  it("denies non-members before touching anything", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "not a member"),
    );
    const res = await cancelAutomatedRun(WS, PROJECT, RUN);
    expect(res.ok).toBe(false);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});
