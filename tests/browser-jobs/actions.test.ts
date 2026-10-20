/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueueBrowserJob,
  listBrowserJobs,
  requestBrowserJobCancellation,
} from "@/lib/browser-jobs/actions";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

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

/** Minimal thenable chain mock for the supabase-js query builder. */
function chain(result: { data?: unknown; error?: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "in",
    "order",
    "limit",
    "insert",
    "update",
    "maybeSingle",
    "single",
  ]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown) => void) =>
    resolve({ data: result.data ?? null, error: result.error ?? null });
  return q;
}

function mockClient(tables: Record<string, { data?: unknown; error?: unknown }>) {
  const from = vi.fn((table: string) => chain(tables[table] ?? {}));
  return { from };
}

const PLAN = {
  version: "1",
  name: "Login flow",
  baseUrl: "https://app.example.com",
  allowedHosts: ["app.example.com"],
  steps: [{ action: "goto", url: "/login" }],
};

const JOB_ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspace_id: WS_ID,
  project_id: PROJECT_ID,
  idempotency_key: "key-12345678",
  plan: PLAN,
  status: "queued",
  attempts: 0,
  max_attempts: 2,
  cancel_requested: false,
  claimed_by: null,
  claimed_at: null,
  lease_expires_at: null,
  result: null,
  error: null,
  created_by: "user-1",
  created_at: "2026-10-19T00:00:00.000Z",
  updated_at: "2026-10-19T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  const client = mockClient({
    projects: { data: { id: PROJECT_ID } },
    browser_jobs: { data: JOB_ROW },
  });
  requireWorkspaceClientMock.mockResolvedValue({ supabase: client, userId: "user-1" });
  createAdminClientMock.mockReturnValue(mockClient({ browser_jobs: { data: { id: JOB_ROW.id } } }));
});

describe("enqueueBrowserJob", () => {
  it("enqueues a validated plan", async () => {
    const result = await enqueueBrowserJob({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      plan: PLAN,
      idempotencyKey: "key-12345678",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.job.id).toBe(JOB_ROW.id);
      expect(result.data.deduplicated).toBe(false);
    }
  });

  it("rejects an invalid plan before any database write", async () => {
    const client = mockClient({});
    requireWorkspaceClientMock.mockResolvedValue({ supabase: client, userId: "user-1" });
    const result = await enqueueBrowserJob({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      plan: { version: "1", name: "x" },
    });
    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS_ID, "not a member"),
    );
    const result = await enqueueBrowserJob({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      plan: PLAN,
    });
    expect(result).toEqual({ ok: false, error: "You don't have access to this workspace." });
  });

  it("rejects a project outside the workspace", async () => {
    const client = mockClient({ projects: { data: null } });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: client, userId: "user-1" });
    const result = await enqueueBrowserJob({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      plan: PLAN,
    });
    expect(result).toEqual({ ok: false, error: "Project not found." });
  });

  it("deduplicates on idempotency-key conflict", async () => {
    const client = mockClient({ projects: { data: { id: PROJECT_ID } } });
    const insertChain = chain({ data: null, error: { code: "23505", message: "duplicate" } });
    const selectChain = chain({ data: JOB_ROW });
    let browserJobsCalls = 0;
    (client.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table !== "browser_jobs") return chain({ data: { id: PROJECT_ID } });
      browserJobsCalls += 1;
      return browserJobsCalls === 1 ? insertChain : selectChain;
    });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: client, userId: "user-1" });
    const result = await enqueueBrowserJob({
      workspaceId: WS_ID,
      projectId: PROJECT_ID,
      plan: PLAN,
      idempotencyKey: "key-12345678",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.deduplicated).toBe(true);
  });
});

describe("requestBrowserJobCancellation", () => {
  it("sets cancel_requested via the admin client after a membership check", async () => {
    const result = await requestBrowserJobCancellation(WS_ID, JOB_ROW.id);
    expect(result).toEqual({ ok: true, data: { jobId: JOB_ROW.id } });
    expect(requireWorkspaceClientMock).toHaveBeenCalledWith(WS_ID);
    expect(createAdminClientMock).toHaveBeenCalled();
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS_ID, "not a member"),
    );
    const result = await requestBrowserJobCancellation(WS_ID, JOB_ROW.id);
    expect(result).toEqual({ ok: false, error: "You don't have access to this workspace." });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});

describe("listBrowserJobs", () => {
  it("returns the workspace's jobs", async () => {
    const client = mockClient({ browser_jobs: { data: [JOB_ROW] } });
    requireWorkspaceClientMock.mockResolvedValue({ supabase: client, userId: "user-1" });
    const result = await listBrowserJobs(WS_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });
});
