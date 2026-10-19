/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSuite,
  duplicateSuite,
  getSuite,
  listSuites,
  updateSuite,
} from "@/lib/suites/actions";
import {
  createTestCase,
  duplicateTestCase,
  getTestCase,
  listTestCases,
  setTestCaseArchived,
  updateTestCase,
} from "@/lib/test-cases/actions";

const WS_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_WS_ID = "99999999-9999-9999-9999-999999999999";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PROJECT_ID = "33333333-3333-3333-3333-333333333333";
const SUITE_ID = "44444444-4444-4444-4444-444444444444";
const CASE_ID = "55555555-5555-5555-5555-555555555555";

/**
 * Ownership-boundary tests. The supabase client is mocked, but
 * assertWorkspaceMembership runs for real — proving every action checks
 * membership before touching data, scopes every query to workspace_id (and
 * project/suite), and never leaks cross-workspace rows.
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
    "overlaps",
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

const SUITE_ROW = {
  id: SUITE_ID,
  workspace_id: WS_ID,
  project_id: PROJECT_ID,
  name: "Smoke tests",
  description: null,
  is_archived: false,
  created_by: USER_ID,
  created_at: "2026-10-18T10:00:00.000Z",
  updated_at: "2026-10-18T12:00:00.000Z",
};

const CASE_ROW = {
  id: CASE_ID,
  workspace_id: WS_ID,
  suite_id: SUITE_ID,
  title: "Login works",
  description: null,
  preconditions: null,
  steps: [{ action: "Enter credentials", expected: "Dashboard opens" }],
  expected_results: null,
  priority: "high",
  tags: ["smoke"],
  status: "active",
  is_archived: false,
  created_by: USER_ID,
  created_at: "2026-10-18T10:00:00.000Z",
  updated_at: "2026-10-18T12:00:00.000Z",
};

let membershipQuery: ReturnType<typeof mockQuery>;
let projectsQuery: ReturnType<typeof mockQuery>;
let suitesQuery: ReturnType<typeof mockQuery>;
let casesQuery: ReturnType<typeof mockQuery>;

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
  membershipQuery = mockQuery({ data: { role: "member" }, error: null });
  projectsQuery = mockQuery({ data: { id: PROJECT_ID }, error: null });
  suitesQuery = mockQuery({ data: SUITE_ROW, error: null });
  casesQuery = mockQuery({ data: CASE_ROW, error: null });
  fromMock.mockImplementation(
    (table: string) =>
      ({
        memberships: membershipQuery,
        projects: projectsQuery,
        suites: suitesQuery,
        test_cases: casesQuery,
      })[table],
  );
});

function eqCalls(q: ReturnType<typeof mockQuery>): Array<[string, unknown]> {
  return (q.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
}

describe("suite actions — workspace isolation", () => {
  it("denies non-members with an indistinguishable message and no data access", async () => {
    membershipQuery = mockQuery({ data: null, error: null });
    const result = await listSuites(WS_ID, PROJECT_ID);
    expect(result).toEqual({
      ok: false,
      error: "You don't have access to this workspace.",
    });
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("memberships");
  });

  it("rejects a project from another workspace without touching suites", async () => {
    projectsQuery = mockQuery({ data: null, error: null });
    const result = await listSuites(WS_ID, PROJECT_ID);
    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(fromMock).not.toHaveBeenCalledWith("suites");
  });

  it("validates input before any database access", async () => {
    const result = await createSuite(WS_ID, PROJECT_ID, { name: "A" });
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("creates a suite scoped to the workspace and project", async () => {
    const result = await createSuite(WS_ID, PROJECT_ID, { name: "Smoke tests" });
    expect(result.ok).toBe(true);
    expect(suitesQuery.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WS_ID,
        project_id: PROJECT_ID,
        name: "Smoke tests",
        created_by: USER_ID,
      }),
    );
  });

  it("reports duplicate suite names per project", async () => {
    suitesQuery = mockQuery({ data: null, error: { code: "23505", message: "dup" } });
    const result = await createSuite(WS_ID, PROJECT_ID, { name: "Smoke tests" });
    expect(result).toEqual({
      ok: false,
      error: "A suite with this name already exists in this project.",
    });
  });

  it("scopes suite reads and writes to workspace, project, and id", async () => {
    await getSuite(WS_ID, PROJECT_ID, SUITE_ID);
    let calls = eqCalls(suitesQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls).toContainEqual(["project_id", PROJECT_ID]);
    expect(calls).toContainEqual(["id", SUITE_ID]);

    await updateSuite(WS_ID, PROJECT_ID, SUITE_ID, { name: "Smoke v2" });
    calls = eqCalls(suitesQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls).toContainEqual(["project_id", PROJECT_ID]);
    expect(calls).toContainEqual(["id", SUITE_ID]);
  });

  it("returns not-found for a suite in another workspace", async () => {
    suitesQuery = mockQuery({ data: null, error: null });
    const result = await getSuite(OTHER_WS_ID, PROJECT_ID, SUITE_ID);
    expect(result).toEqual({ ok: false, error: "Suite not found." });
  });

  it("duplicates a suite with copies of its active cases", async () => {
    const newSuite = { ...SUITE_ROW, id: "66666666-6666-6666-6666-666666666666" };
    suitesQuery = mockQuery({ data: newSuite, error: null });
    casesQuery = mockQuery({ data: [CASE_ROW], error: null });

    const result = await duplicateSuite(WS_ID, PROJECT_ID, SUITE_ID);
    expect(result.ok).toBe(true);
    expect(suitesQuery.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Smoke tests (copy)" }),
    );
    // Only non-archived cases are copied.
    expect(eqCalls(casesQuery)).toContainEqual(["is_archived", false]);
    expect(casesQuery.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WS_ID,
        suite_id: newSuite.id,
        title: "Login works (copy)",
        status: "draft",
      }),
    );
  });
});

describe("test-case actions — workspace isolation", () => {
  it("denies non-members without touching test cases", async () => {
    membershipQuery = mockQuery({ data: null, error: null });
    const result = await listTestCases(WS_ID, PROJECT_ID, SUITE_ID);
    expect(result).toEqual({
      ok: false,
      error: "You don't have access to this workspace.",
    });
    expect(fromMock).not.toHaveBeenCalledWith("test_cases");
  });

  it("rejects a suite from another workspace without touching cases", async () => {
    suitesQuery = mockQuery({ data: null, error: null });
    const result = await createTestCase(WS_ID, PROJECT_ID, SUITE_ID, {
      title: "Login works",
    });
    expect(result).toEqual({ ok: false, error: "Suite not found." });
    expect(fromMock).not.toHaveBeenCalledWith("test_cases");
  });

  it("validates steps before any database access", async () => {
    const result = await createTestCase(WS_ID, PROJECT_ID, SUITE_ID, {
      title: "Login works",
      steps: [{ action: "  " }],
    });
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalledWith("test_cases");
  });

  it("creates a case scoped to workspace and suite", async () => {
    const result = await createTestCase(WS_ID, PROJECT_ID, SUITE_ID, {
      title: "Login works",
      steps: [{ action: "Enter credentials", expected: "Dashboard opens" }],
      priority: "high",
      tags: ["smoke"],
    });
    expect(result.ok).toBe(true);
    expect(casesQuery.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WS_ID,
        suite_id: SUITE_ID,
        title: "Login works",
        priority: "high",
        tags: ["smoke"],
        created_by: USER_ID,
      }),
    );
    if (result.ok) {
      expect(result.data.steps).toEqual([
        { action: "Enter credentials", expected: "Dashboard opens" },
      ]);
    }
  });

  it("scopes case reads and writes to workspace, suite, and id", async () => {
    await getTestCase(WS_ID, SUITE_ID, CASE_ID);
    const calls = eqCalls(casesQuery);
    expect(calls).toContainEqual(["workspace_id", WS_ID]);
    expect(calls).toContainEqual(["suite_id", SUITE_ID]);
    expect(calls).toContainEqual(["id", CASE_ID]);

    await updateTestCase(WS_ID, PROJECT_ID, SUITE_ID, CASE_ID, {
      title: "Login works v2",
    });
    const updateCalls = eqCalls(casesQuery);
    expect(updateCalls).toContainEqual(["workspace_id", WS_ID]);
    expect(updateCalls).toContainEqual(["suite_id", SUITE_ID]);
    expect(updateCalls).toContainEqual(["id", CASE_ID]);
  });

  it("applies status, priority, tag, and search filters", async () => {
    casesQuery = mockQuery({ data: [], error: null });
    await listTestCases(WS_ID, PROJECT_ID, SUITE_ID, {
      status: "active",
      priority: "high",
      tags: ["smoke"],
      search: "login",
    });
    const calls = eqCalls(casesQuery);
    expect(calls).toContainEqual(["status", "active"]);
    expect(calls).toContainEqual(["priority", "high"]);
    expect(casesQuery.overlaps as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("tags", ["smoke"]);
    expect(casesQuery.ilike as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("title", "%login%");
  });

  it("archives by flag and keeps history readable", async () => {
    const archived = await setTestCaseArchived(WS_ID, PROJECT_ID, SUITE_ID, CASE_ID, true);
    expect(archived.ok).toBe(true);
    expect(casesQuery.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      is_archived: true,
    });
    // Archived history stays readable: fetching the archived row works.
    casesQuery = mockQuery({ data: { ...CASE_ROW, is_archived: true }, error: null });
    const fetched = await getTestCase(WS_ID, SUITE_ID, CASE_ID);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.data.isArchived).toBe(true);
  });

  it("duplicates a case as a draft in the same suite", async () => {
    const copy = { ...CASE_ROW, id: "77777777-7777-7777-7777-777777777777" };
    casesQuery = mockQuery({ data: copy, error: null });
    const result = await duplicateTestCase(WS_ID, PROJECT_ID, SUITE_ID, CASE_ID);
    expect(result.ok).toBe(true);
    expect(casesQuery.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WS_ID,
        suite_id: SUITE_ID,
        title: "Login works (copy)",
        status: "draft",
      }),
    );
  });

  it("never returns a case from another workspace", async () => {
    casesQuery = mockQuery({ data: null, error: null });
    const result = await getTestCase(OTHER_WS_ID, SUITE_ID, CASE_ID);
    expect(result).toEqual({ ok: false, error: "Test case not found." });
  });
});
