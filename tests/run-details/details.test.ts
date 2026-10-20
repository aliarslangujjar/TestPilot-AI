/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAutomatedRunDetail } from "@/lib/run-details/details";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CASE1 = "33333333-3333-4333-8333-333333333333";
const CASE2 = "44444444-4444-4333-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const RESULT1 = "66666666-6666-4666-8666-666666666666";
const RESULT2 = "77777777-7777-4777-8777-777777777777";
const JOB1 = "88888888-8888-4888-8888-888888888888";
const JOB2 = "99999999-9999-4999-8999-999999999999";

const { requireWorkspaceClientMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function mockDb(presets: Record<string, unknown>) {
  function chain(table: string) {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.in = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.limit = vi.fn(() => q);
    q.contains = vi.fn(() => q);
    q.maybeSingle = vi.fn(() => q);
    q.then = (resolve: (value: unknown) => void) => {
      const preset = presets[table];
      const value =
        preset && typeof preset === "object" && "rows" in preset
          ? { data: (preset as { rows: unknown }).rows, error: null }
          : { data: preset ?? null, error: null };
      resolve(value);
    };
    return q;
  }
  return { from: vi.fn((t: string) => chain(t)) };
}

const PLAN = {
  version: "1",
  name: "Flow",
  baseUrl: "https://app.example.com",
  allowedHosts: ["app.example.com"],
  description: "",
  steps: [
    { action: "goto", url: "https://app.example.com/" },
    { action: "click", locator: { by: "role", role: "button", name: "Submit" } },
  ],
};

const JOB1_RESULT = {
  status: "failed",
  steps: [
    { index: 0, action: "goto", ok: true, durationMs: 300 },
    {
      index: 1,
      action: "click",
      ok: false,
      durationMs: 1500,
      error: "locator not found, password=hunter2 was not filled",
    },
  ],
  artifacts: [`${WS}/${JOB1}/step-1.png`],
  diagnostics: {
    consoleErrors: ["TypeError: cannot read properties of null (reading 'submit')"],
    networkErrors: [],
  },
  startedAt: "2026-10-19T00:00:00.000Z",
  finishedAt: "2026-10-19T00:00:02.000Z",
};

const JOB2_RESULT = {
  status: "succeeded",
  steps: [{ index: 0, action: "goto", ok: true, durationMs: 200 }],
  artifacts: [],
  startedAt: "2026-10-19T00:00:00.000Z",
  finishedAt: "2026-10-19T00:00:01.000Z",
};

const ANALYSIS_ENVELOPE = {
  analysis: {
    explanation: "The most likely explanation is a locator mismatch.",
    supportingEvidence: ["Step 1 (click) failed: locator not found"],
    probableClassification: "locator_issue",
    confidence: 0.55,
    uncertainty: "This is a hypothesis from the rule-based fallback.",
    debuggingSteps: ["Open the page and inspect the Submit control."],
    fixSuggestions: [
      { suggestion: "Update the locator.", evidenceBasis: "Step 1 (click) failed." },
    ],
  },
  source: "fallback",
  model: null,
  analyzedAt: "2026-10-19T00:01:00.000Z",
};

function setDb() {
  const db = mockDb({
    test_runs: {
      id: RUN,
      name: "Nightly automated",
      source: "automated",
      status: "completed",
      execution_status: "failed",
      created_at: "2026-10-19T00:00:00.000Z",
      completed_at: "2026-10-19T00:00:05.000Z",
    },
    run_results: {
      rows: [
        {
          id: RESULT1,
          test_case_id: CASE1,
          snapshot: { title: "Submit flow" },
          outcome: "fail",
          browser_job_id: JOB1,
          execution_status: "failed",
          artifacts: [`${WS}/${JOB1}/step-1.png`],
          failure_analysis: ANALYSIS_ENVELOPE,
          created_at: "2026-10-19T00:00:00.000Z",
        },
        {
          id: RESULT2,
          test_case_id: CASE2,
          snapshot: { title: "Home loads" },
          outcome: "pass",
          browser_job_id: JOB2,
          execution_status: "passed",
          artifacts: [],
          failure_analysis: null,
          created_at: "2026-10-19T00:00:00.000Z",
        },
      ],
    },
    browser_jobs: {
      rows: [
        {
          id: JOB1,
          status: "failed",
          failure_kind: "assertion",
          attempts: 1,
          error: "locator not found",
          plan: PLAN,
          result: JOB1_RESULT,
        },
        {
          id: JOB2,
          status: "succeeded",
          failure_kind: null,
          attempts: 1,
          error: null,
          plan: PLAN,
          result: JOB2_RESULT,
        },
      ],
    },
  });
  requireWorkspaceClientMock.mockResolvedValue({ supabase: db });
}

beforeEach(() => {
  requireWorkspaceClientMock.mockReset();
});

describe("getAutomatedRunDetail", () => {
  it("returns run status, duration, and an execution summary", async () => {
    setDb();
    const res = await getAutomatedRunDetail(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.executionStatus).toBe("failed");
    expect(res.data.durationMs).toBe(5000);
    expect(res.data.summary).toMatchObject({ total: 2, passed: 1, failed: 1, timedOut: 0 });
  });

  it("includes per-test steps, expected vs actual, and re-sanitized logs", async () => {
    setDb();
    const res = await getAutomatedRunDetail(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.data.results[0];
    expect(r?.caseTitle).toBe("Submit flow");
    expect(r?.steps).toHaveLength(2);
    expect(r?.steps[1]?.ok).toBe(false);
    // Expected/actual from the evidence bundle for the failed step.
    expect(r?.expected ?? "").toContain("click");
    expect(r?.actual ?? "").toContain("locator not found");
    // Step errors are sanitized again in the detail (password redacted).
    expect(r?.steps[1]?.error ?? "").not.toContain("hunter2");
    expect(r?.logs.consoleErrors).toHaveLength(1);
    expect(r?.logs.consoleErrors[0]).toContain("TypeError");
    expect(r?.durationMs).toBe(2000);
  });

  it("passes through artifact metadata (paths only) and stored analysis", async () => {
    setDb();
    const res = await getAutomatedRunDetail(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.results[0]?.artifacts).toEqual([`${WS}/${JOB1}/step-1.png`]);
    const analysis = res.data.results[0]?.analysis;
    expect(analysis?.source).toBe("fallback");
    expect(analysis?.analysis.probableClassification).toBe("locator_issue");
    expect(analysis?.analysis.uncertainty).toContain("hypothesis");
  });

  it("gives passing results no expected/actual and no analysis", async () => {
    setDb();
    const res = await getAutomatedRunDetail(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.data.results[1];
    expect(r?.expected).toBeNull();
    expect(r?.actual).toBeNull();
    expect(r?.analysis).toBeNull();
  });

  it("returns NOT FOUND for a manual run", async () => {
    const db = mockDb({
      test_runs: {
        id: RUN,
        name: "Manual",
        source: "manual",
        status: "completed",
        execution_status: null,
        created_at: "2026-10-19T00:00:00.000Z",
        completed_at: null,
      },
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: db });
    const res = await getAutomatedRunDetail(WS, PROJECT, RUN);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Test run not found.");
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await getAutomatedRunDetail(WS, PROJECT, RUN);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("You don't have access to this workspace.");
  });
});
