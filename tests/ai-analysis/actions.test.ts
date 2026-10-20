/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeRunFailure, getFailureAnalysis } from "@/lib/ai-analysis/actions";
import { AIServiceError } from "@/lib/ai/errors";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const RUN = "55555555-5555-4555-8555-555555555555";
const RESULT = "77777777-7777-4777-8777-777777777777";
const JOB = "66666666-6666-4666-8666-666666666666";

const { requireWorkspaceClientMock, getAIStatusMock, generateStructuredMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
  getAIStatusMock: vi.fn(),
  generateStructuredMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/ai/service", () => ({
  getAIStatus: (...args: unknown[]) => getAIStatusMock(...args),
  generateStructured: (...args: unknown[]) => generateStructuredMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface RecordedOp {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

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
    q.maybeSingle = vi.fn(() => q);
    q.single = vi.fn(() => q);
    q.update = vi.fn((patch: unknown) => {
      ops.push({ table, op: "update", payload: patch, filters });
      return q;
    });
    q.then = (resolve: (v: unknown) => void) =>
      resolve({ data: presets[table] ?? null, error: null });
    return q;
  }
  return { ops, from: vi.fn((t: string) => chain(t)) };
}

const PLAN = {
  version: "1",
  name: "Login flow",
  description: "",
  baseUrl: "https://app.example.com",
  allowedHosts: ["app.example.com"],
  steps: [{ action: "goto", url: "/login" }],
};

const JOB_RESULT = {
  status: "failed",
  steps: [
    { index: 0, action: "goto", ok: false, durationMs: 100, error: "net::ERR_CONNECTION_REFUSED" },
  ],
  artifacts: [],
  startedAt: "2026-10-19T21:00:00.000Z",
  finishedAt: "2026-10-19T21:01:00.000Z",
};

const failedDb = () =>
  mockDb({
    test_runs: { id: RUN, source: "automated" },
    run_results: {
      id: RESULT,
      execution_status: "failed",
      snapshot: { title: "Login flow" },
      browser_job_id: JOB,
      failure_analysis: null,
    },
    browser_jobs: {
      status: "failed",
      failure_kind: "infra",
      attempts: 2,
      error: "All 2 attempts failed. Last error: net::ERR_CONNECTION_REFUSED",
      plan: PLAN,
      result: JOB_RESULT,
    },
  });

const AI_ANALYSIS = {
  explanation: "The navigation step failed because the target was unreachable.",
  supportingEvidence: [
    "Network error recorded: GET https://app.example.com/login (net::ERR_CONNECTION_REFUSED).",
  ],
  probableClassification: "network_issue",
  confidence: 0.8,
  uncertainty: "Could not determine whether the outage was transient.",
  debuggingSteps: ["Check whether the environment was reachable."],
  fixSuggestions: [
    {
      suggestion: "Re-run once the target recovers.",
      evidenceBasis: "Network error recorded in the run.",
    },
  ],
};

function memberClient(db: ReturnType<typeof mockDb>) {
  requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAIStatusMock.mockResolvedValue({ enabled: false, provider: "openai", model: "gpt-4o-mini" });
  generateStructuredMock.mockResolvedValue({
    data: AI_ANALYSIS,
    usage: { inputTokens: 100, outputTokens: 50 },
  });
});

describe("analyzeRunFailure", () => {
  it("uses the fallback when AI is disabled and never calls the provider", async () => {
    const db = failedDb();
    memberClient(db);
    const res = await analyzeRunFailure(WS, PROJECT, RUN, RESULT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.source).toBe("fallback");
    expect(res.data.model).toBeNull();
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(res.data.analysis.probableClassification).toBe("network_issue");

    const update = db.ops.find((o) => o.table === "run_results" && o.op === "update");
    expect(update?.payload).toMatchObject({ failure_analysis_source: "fallback" });
    expect(
      (update?.payload as { failure_analysis: { source: string } }).failure_analysis.source,
    ).toBe("fallback");
  });

  it("calls the metered AI service when enabled and persists the AI analysis", async () => {
    getAIStatusMock.mockResolvedValue({ enabled: true, provider: "openai", model: "gpt-4o-mini" });
    const db = failedDb();
    memberClient(db);
    const res = await analyzeRunFailure(WS, PROJECT, RUN, RESULT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.source).toBe("ai");
    expect(res.data.model).toBe("gpt-4o-mini");
    // Metering happens inside generateStructured; the action routes through it.
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    const call = generateStructuredMock.mock.calls[0]?.[0] as {
      workspaceId: string;
      prompt: string;
    };
    expect(call.workspaceId).toBe(WS);
    expect(call.prompt).toContain("Login flow");

    const update = db.ops.find((o) => o.table === "run_results" && o.op === "update");
    expect(update?.payload).toMatchObject({ failure_analysis_source: "ai" });
  });

  it("returns a typed AI error without persisting anything", async () => {
    getAIStatusMock.mockResolvedValue({ enabled: true, provider: "openai", model: "gpt-4o-mini" });
    generateStructuredMock.mockRejectedValue(
      new AIServiceError("AI_QUOTA_EXCEEDED", "Quota exceeded."),
    );
    const db = failedDb();
    memberClient(db);
    const res = await analyzeRunFailure(WS, PROJECT, RUN, RESULT);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Quota exceeded");
    expect(db.ops.filter((o) => o.op === "update")).toHaveLength(0);
  });

  it("refuses passed results, unlinked results, and missing jobs", async () => {
    const passedDb = mockDb({
      test_runs: { id: RUN, source: "automated" },
      run_results: {
        id: RESULT,
        execution_status: "passed",
        snapshot: { title: "T" },
        browser_job_id: JOB,
        failure_analysis: null,
      },
      browser_jobs: {},
    });
    memberClient(passedDb);
    expect((await analyzeRunFailure(WS, PROJECT, RUN, RESULT)).ok).toBe(false);

    const db2 = mockDb({
      test_runs: { id: RUN, source: "automated" },
      run_results: {
        id: RESULT,
        execution_status: "timed_out",
        snapshot: { title: "T" },
        browser_job_id: null,
        failure_analysis: null,
      },
      browser_jobs: {},
    });
    memberClient(db2);
    const res = await analyzeRunFailure(WS, PROJECT, RUN, RESULT);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("No worker job");
  });

  it("rejects invalid stored plans and non-members", async () => {
    const db = mockDb({
      test_runs: { id: RUN, source: "automated" },
      run_results: {
        id: RESULT,
        execution_status: "failed",
        snapshot: { title: "T" },
        browser_job_id: JOB,
        failure_analysis: null,
      },
      browser_jobs: {
        status: "failed",
        failure_kind: null,
        attempts: 1,
        error: null,
        plan: { garbage: true },
        result: null,
      },
    });
    memberClient(db);
    const res = await analyzeRunFailure(WS, PROJECT, RUN, RESULT);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("invalid");

    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "not a member"),
    );
    expect((await analyzeRunFailure(WS, PROJECT, RUN, RESULT)).ok).toBe(false);
  });
});

describe("getFailureAnalysis", () => {
  it("returns a stored analysis, or null when none exists", async () => {
    const stored = {
      analysis: AI_ANALYSIS,
      source: "ai",
      model: "gpt-4o-mini",
      analyzedAt: "2026-10-19T21:30:00.000Z",
    };
    memberClient(
      mockDb({
        test_runs: { id: RUN },
        run_results: { failure_analysis: stored },
      }),
    );
    const res = await getFailureAnalysis(WS, PROJECT, RUN, RESULT);
    expect(res.ok && res.data).toEqual(stored);

    memberClient(mockDb({ test_runs: { id: RUN }, run_results: { failure_analysis: null } }));
    const empty = await getFailureAnalysis(WS, PROJECT, RUN, RESULT);
    expect(empty.ok && empty.data).toBeNull();
  });

  it("returns null for a corrupted stored envelope rather than crashing", async () => {
    memberClient(
      mockDb({ test_runs: { id: RUN }, run_results: { failure_analysis: { bogus: true } } }),
    );
    const res = await getFailureAnalysis(WS, PROJECT, RUN, RESULT);
    expect(res.ok && res.data).toBeNull();
  });
});
