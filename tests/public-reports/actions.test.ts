/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPublicReport,
  listPublicReports,
  revokePublicReport,
} from "@/lib/public-reports/actions";
import { hashShareToken } from "@/lib/public-reports/token";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const RUN = "55555555-5555-4555-8555-555555555555";
const REPORT = "66666666-6666-4666-8666-666666666666";
const JOB = "77777777-7777-4777-8777-777777777777";
const SECRET_LOG = "TypeError: password=hunter2 exploded";
const ARTIFACT_PATH = `${WS}/${JOB}/step-1.png`;

const { requireWorkspaceClientMock, getAutomatedRunDetailMock, getRunMock, listRunResultsMock } =
  vi.hoisted(() => ({
    requireWorkspaceClientMock: vi.fn(),
    getAutomatedRunDetailMock: vi.fn(),
    getRunMock: vi.fn(),
    listRunResultsMock: vi.fn(),
  }));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/run-details/details", () => ({
  getAutomatedRunDetail: (...args: unknown[]) => getAutomatedRunDetailMock(...args),
}));

vi.mock("@/lib/test-runs/actions", () => ({
  getRun: (...args: unknown[]) => getRunMock(...args),
  listRunResults: (...args: unknown[]) => listRunResultsMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface RecordedOp {
  table: string;
  op: "insert" | "update" | "delete";
  payload?: unknown;
}

function mockDb(presets: Record<string, { data: unknown; error: unknown }>) {
  const ops: RecordedOp[] = [];
  function chain(table: string) {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.order = vi.fn(() => q);
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

const AUTOMATED_DETAIL = {
  runId: RUN,
  name: "Nightly run",
  status: "completed",
  executionStatus: "failed",
  createdAt: "2026-10-20T00:00:00.000Z",
  completedAt: "2026-10-20T00:05:00.000Z",
  durationMs: 300_000,
  summary: { total: 1, passed: 0, failed: 1, timedOut: 0, cancelled: 0, queued: 0, running: 0 },
  results: [
    {
      resultId: "r1",
      testCaseId: "c1",
      caseTitle: "Pay with card",
      outcome: "fail",
      executionStatus: "failed",
      browserJobId: JOB,
      attempts: 1,
      failureKind: "assertion",
      durationMs: 2000,
      steps: [
        { index: 0, action: "goto", ok: true, durationMs: 100, error: null },
        { index: 1, action: "click", ok: false, durationMs: 300, error: SECRET_LOG },
      ],
      expected: 'role button "Pay" to be clickable',
      actual: "not found",
      logs: { consoleErrors: [SECRET_LOG], networkErrors: [] },
      artifacts: [ARTIFACT_PATH],
      analysis: null,
    },
  ],
};

function setupDb(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  const db = mockDb({
    projects: { data: { id: PROJECT, name: "Shop" }, error: null },
    public_reports: { data: { id: REPORT }, error: null },
    ...overrides,
  });
  requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId: "user-1" });
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAutomatedRunDetailMock.mockResolvedValue({ ok: true, data: AUTOMATED_DETAIL });
  getRunMock.mockResolvedValue({ ok: false, error: "Test run not found." });
  listRunResultsMock.mockResolvedValue({ ok: false, error: "Test run not found." });
});

describe("createPublicReport", () => {
  it("stores only the token hash and a snapshot free of logs and artifacts", async () => {
    const db = setupDb();
    const res = await createPublicReport(WS, PROJECT, RUN, {
      includeFailureDetails: true,
      noIndex: true,
      expiresInDays: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.path).toBe(`/r/${res.data.token}`);

    const inserts = db.ops.filter((o) => o.table === "public_reports" && o.op === "insert");
    expect(inserts).toHaveLength(1);
    const payload = inserts[0]?.payload as Record<string, unknown>;
    expect(payload.token_hash).toBe(hashShareToken(res.data.token));
    // The raw token appears NOWHERE in the stored payload.
    expect(JSON.stringify(payload)).not.toContain(res.data.token);
    // Snapshot leakage checks: no logs, no artifact paths, no job ids.
    const snapshotJson = JSON.stringify(payload.snapshot);
    expect(snapshotJson).not.toContain(SECRET_LOG);
    expect(snapshotJson).not.toContain("hunter2");
    expect(snapshotJson).not.toContain(ARTIFACT_PATH);
    expect(snapshotJson).not.toContain(JOB);
    expect(snapshotJson).not.toContain(WS);
    // Failure evidence IS present (opted in), sanitized by construction.
    expect(snapshotJson).toContain("to be clickable");
  });

  it("defaults to no failure details", async () => {
    const db = setupDb();
    const res = await createPublicReport(WS, PROJECT, RUN, {});
    expect(res.ok).toBe(true);
    const payload = db.ops.find((o) => o.table === "public_reports")?.payload as Record<
      string,
      unknown
    >;
    expect(payload.include_failure_details).toBe(false);
    expect(JSON.stringify(payload.snapshot)).not.toContain("to be clickable");
  });

  it("falls back to manual runs and excludes run notes and result notes", async () => {
    const db = setupDb();
    getAutomatedRunDetailMock.mockResolvedValue({ ok: false, error: "Test run not found." });
    getRunMock.mockResolvedValue({
      ok: true,
      data: {
        id: RUN,
        name: "Manual run",
        source: "manual",
        status: "completed",
        createdAt: "2026-10-20T00:00:00.000Z",
        completedAt: "2026-10-20T00:10:00.000Z",
        summary: { total: 1, unexecuted: 0, pass: 1, fail: 0, blocked: 0, skipped: 0 },
      },
    });
    listRunResultsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "r1",
          snapshot: { title: "Manual case" },
          outcome: "pass",
          notes: "internal note with password=hunter2",
        },
      ],
    });
    const res = await createPublicReport(WS, PROJECT, RUN, {});
    expect(res.ok).toBe(true);
    const payload = db.ops.find((o) => o.table === "public_reports")?.payload as Record<
      string,
      unknown
    >;
    const snapshot = payload.snapshot as { source: string };
    expect(snapshot.source).toBe("manual");
    expect(JSON.stringify(payload.snapshot)).not.toContain("internal note");
    expect(JSON.stringify(payload.snapshot)).not.toContain("hunter2");
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await createPublicReport(WS, PROJECT, RUN, {});
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("You don't have access to this workspace.");
  });

  it("returns NOT FOUND for a missing run", async () => {
    setupDb();
    getAutomatedRunDetailMock.mockResolvedValue({ ok: false, error: "Test run not found." });
    const res = await createPublicReport(WS, PROJECT, RUN, {});
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Test run not found.");
  });
});

describe("revokePublicReport", () => {
  it("sets revoked_at on an active report", async () => {
    const db = setupDb({
      public_reports: { data: { id: REPORT, revoked_at: null }, error: null },
    });
    const res = await revokePublicReport(WS, PROJECT, REPORT);
    expect(res.ok).toBe(true);
    const updates = db.ops.filter((o) => o.table === "public_reports" && o.op === "update");
    expect(updates).toHaveLength(1);
    expect((updates[0]?.payload as { revoked_at: string }).revoked_at).toBeTruthy();
  });

  it("is idempotent for an already-revoked report", async () => {
    const db = setupDb({
      public_reports: { data: { id: REPORT, revoked_at: "2026-10-20T01:00:00.000Z" }, error: null },
    });
    const res = await revokePublicReport(WS, PROJECT, REPORT);
    expect(res.ok).toBe(true);
    expect(db.ops.filter((o) => o.op === "update")).toHaveLength(0);
  });

  it("returns NOT FOUND for a report outside the project", async () => {
    setupDb({ public_reports: { data: null, error: null } });
    const res = await revokePublicReport(WS, PROJECT, REPORT);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Public report not found.");
  });
});

describe("listPublicReports", () => {
  it("returns metadata without any token material", async () => {
    setupDb({
      public_reports: {
        data: [
          {
            id: REPORT,
            project_id: PROJECT,
            run_id: RUN,
            run_name: "Nightly run",
            include_failure_details: false,
            no_index: true,
            expires_at: null,
            revoked_at: null,
            view_count: 5,
            last_viewed_at: null,
            created_at: "2026-10-20T01:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    const res = await listPublicReports(WS, PROJECT, RUN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]?.viewCount).toBe(5);
    expect(JSON.stringify(res.data)).not.toContain("token");
  });
});
