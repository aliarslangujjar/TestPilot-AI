/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  getProject,
  listProjects,
  setProjectArchived,
  updateProject,
} from "@/lib/projects/actions";

const WS_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_WS_ID = "99999999-9999-9999-9999-999999999999";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PROJECT_ID = "33333333-3333-3333-3333-333333333333";

/**
 * Ownership-boundary tests. The supabase client is mocked, but
 * assertWorkspaceMembership runs for real — so these tests prove every
 * action checks membership before touching project data, scopes every
 * query to workspace_id, and never leaks cross-workspace rows.
 */

const { fromMock, getUserMock, createClientMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/** Chainable, thenable supabase-js query stub. */
function mockQuery(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "ilike",
    "like",
    "order",
    "limit",
    "single",
    "maybeSingle",
    "is",
  ]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown) => void) => resolve(result);
  return q;
}

const PROJECT_ROW = {
  id: PROJECT_ID,
  workspace_id: WS_ID,
  name: "Billing API",
  description: "Covers invoicing.",
  base_url: "https://staging.example.com",
  is_archived: false,
  created_by: USER_ID,
  created_at: "2026-10-18T10:00:00.000Z",
  updated_at: "2026-10-18T12:00:00.000Z",
};

let membershipQuery: ReturnType<typeof mockQuery>;
let projectsQuery: ReturnType<typeof mockQuery>;

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
  membershipQuery = mockQuery({ data: { role: "member" }, error: null });
  projectsQuery = mockQuery({ data: PROJECT_ROW, error: null });
  fromMock.mockImplementation((table: string) =>
    table === "memberships" ? membershipQuery : projectsQuery,
  );
});

function eqCalls(q: ReturnType<typeof mockQuery>): Array<[string, unknown]> {
  return (q.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
}

describe("project actions — ownership boundaries", () => {
  it("validates input before any database access", async () => {
    const result = await createProject(WS_ID, {
      name: "Billing API",
      baseUrl: "ftp://not-allowed.example",
    } as never);
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("denies non-members with an indistinguishable message and no project access", async () => {
    membershipQuery = mockQuery({ data: null, error: null });
    const result = await listProjects(WS_ID);
    expect(result).toEqual({
      ok: false,
      error: "You don't have access to this workspace.",
    });
    // Only the membership check ran — the projects table was never touched.
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("memberships");
  });

  it("denies signed-out callers without touching project data", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const result = await getProject(WS_ID, PROJECT_ID);
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("creates with the workspace id and creator recorded", async () => {
    const result = await createProject(WS_ID, {
      name: "Billing API",
      description: "Covers invoicing.",
      baseUrl: "https://staging.example.com",
    });
    expect(result.ok).toBe(true);
    const insert = projectsQuery.insert as ReturnType<typeof vi.fn>;
    expect(insert).toHaveBeenCalledWith({
      workspace_id: WS_ID,
      name: "Billing API",
      description: "Covers invoicing.",
      base_url: "https://staging.example.com",
      created_by: USER_ID,
    });
    if (result.ok) {
      expect(result.data.workspaceId).toBe(WS_ID);
      expect(result.data.baseUrl).toBe("https://staging.example.com");
    }
  });

  it("reports duplicate names per workspace", async () => {
    projectsQuery = mockQuery({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const result = await createProject(WS_ID, { name: "Billing API" });
    expect(result).toEqual({
      ok: false,
      error: "A project with this name already exists in this workspace.",
    });
  });

  it("scopes updates to the workspace and project id", async () => {
    const result = await updateProject(WS_ID, PROJECT_ID, { name: "Billing API v2" });
    expect(result.ok).toBe(true);
    const calls = eqCalls(projectsQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls).toContainEqual(["id", PROJECT_ID]);
    expect(projectsQuery.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Billing API v2" }),
    );
  });

  it("returns not-found for a project in another workspace", async () => {
    // A project that doesn't belong to WS_ID yields no row under the
    // workspace-scoped query — never a cross-workspace read.
    projectsQuery = mockQuery({ data: null, error: null });
    const result = await getProject(WS_ID, PROJECT_ID);
    expect(result).toEqual({ ok: false, error: "Project not found." });
    const calls = eqCalls(projectsQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls).toContainEqual(["id", PROJECT_ID]);
  });

  it("archives by setting the flag, scoped to workspace and id", async () => {
    const result = await setProjectArchived(WS_ID, PROJECT_ID, true);
    expect(result.ok).toBe(true);
    expect(projectsQuery.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      is_archived: true,
    });
    const calls = eqCalls(projectsQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls).toContainEqual(["id", PROJECT_ID]);
  });

  it("excludes archived projects from the default list", async () => {
    projectsQuery = mockQuery({ data: [], error: null });
    const result = await listProjects(WS_ID);
    expect(result.ok).toBe(true);
    const calls = eqCalls(projectsQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls).toContainEqual(["is_archived", false]);
  });

  it("includes archived projects only when asked", async () => {
    projectsQuery = mockQuery({ data: [], error: null });
    await listProjects(WS_ID, { includeArchived: true });
    const calls = eqCalls(projectsQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls.some(([col]) => col === "is_archived")).toBe(false);
  });

  it("escapes LIKE wildcards in search input", async () => {
    projectsQuery = mockQuery({ data: [], error: null });
    await listProjects(WS_ID, { search: "100%_coverage" });
    expect(projectsQuery.ilike as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "name",
      "%100\\%\\_coverage%",
    );
  });

  it("rejects overlong search input without querying", async () => {
    const result = await listProjects(WS_ID, { search: "x".repeat(101) });
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalledWith("projects");
  });

  it("checks membership against the requested workspace, not another", async () => {
    await listProjects(OTHER_WS_ID);
    const calls = eqCalls(membershipQuery);
    expect(calls).toContainEqual(["workspace_id", OTHER_WS_ID]);
  });
});
