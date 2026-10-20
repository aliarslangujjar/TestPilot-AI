/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteCommunityTemplate,
  getCommunityTemplate,
  importCommunityTemplate,
  listCommunityTemplates,
  publishCommunityTemplate,
  reportCommunityTemplate,
  unpublishCommunityTemplate,
} from "@/lib/community/actions";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";
const SUITE = "55555555-5555-4555-8555-555555555555";
const AUTHOR = "66666666-6666-4666-8666-666666666666";
const OTHER_USER = "77777777-7777-4777-8777-777777777777";

const { requireWorkspaceClientMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface RecordedOp {
  table: string;
  op: string;
  payload?: unknown;
}

function mockDb(presets: Record<string, { data: unknown; error: unknown }>) {
  const ops: RecordedOp[] = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  function chain(table: string) {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "contains", "ilike", "order", "limit"]) {
      q[m] = vi.fn(() => q);
    }
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
  return {
    ops,
    rpcCalls,
    from: vi.fn((t: string) => chain(t)),
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    }),
  };
}

const PLAN_CASE = {
  title: "Checkout with a valid card",
  objective: "Verify the happy-path checkout",
  preconditions: "Signed in",
  steps: [{ action: "Open checkout", expected: "Form loads" }],
  expectedResults: "Order placed",
  priority: "high",
  coverage: "positive",
  testType: "functional",
  area: "Checkout",
  assumptions: [],
};

const TEMPLATE_ROW = {
  id: TEMPLATE,
  name: "Checkout basics",
  description: "Core checkout coverage",
  app_type: "ecommerce",
  license: "CC-BY-4.0",
  tags: ["checkout"],
  author_user_id: AUTHOR,
  author_display_name: "Ali QA",
  case_count: 1,
  view_count: 2,
  import_count: 0,
  status: "published",
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-20T00:00:00.000Z",
  content: { cases: [PLAN_CASE] },
};

function setupDb(
  overrides: Record<string, { data: unknown; error: unknown }> = {},
  userId = AUTHOR,
) {
  const db = mockDb({
    test_plans: {
      data: {
        id: PLAN,
        name: "Checkout plan",
        template_key: "ecommerce",
        plan: { cases: [PLAN_CASE] },
      },
      error: null,
    },
    profiles: { data: { display_name: "Ali QA" }, error: null },
    community_templates: { data: TEMPLATE_ROW, error: null },
    projects: { data: { id: PROJECT }, error: null },
    suites: { data: { id: SUITE }, error: null },
    test_cases: { data: null, error: null },
    community_template_reports: { data: null, error: null },
    ...overrides,
  });
  requireWorkspaceClientMock.mockResolvedValue({ supabase: db, userId });
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishCommunityTemplate", () => {
  it("snapshots the plan with author attribution and license", async () => {
    const db = setupDb();
    const res = await publishCommunityTemplate(WS, PROJECT, PLAN, {
      description: "Core checkout coverage",
      license: "CC-BY-4.0",
      tags: ["checkout"],
    });
    expect(res.ok).toBe(true);
    const insert = db.ops.find((o) => o.table === "community_templates" && o.op === "insert");
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload.author_user_id).toBe(AUTHOR);
    expect(payload.author_display_name).toBe("Ali QA");
    expect(payload.license).toBe("CC-BY-4.0");
    expect(payload.app_type).toBe("ecommerce");
    expect(payload.case_count).toBe(1);
    // Published copy is decoupled: no workspace or project id in the row.
    expect(JSON.stringify(payload)).not.toContain(WS);
    expect(JSON.stringify(payload)).not.toContain(PROJECT);
  });

  it("falls back to Anonymous when the author has no display name", async () => {
    const db = setupDb({ profiles: { data: { display_name: null }, error: null } });
    await publishCommunityTemplate(WS, PROJECT, PLAN, { license: "MIT" });
    const insert = db.ops.find((o) => o.table === "community_templates");
    expect((insert?.payload as { author_display_name: string }).author_display_name).toBe(
      "Anonymous",
    );
  });

  it("refuses to publish a plan whose cases fail validation", async () => {
    const db = setupDb({
      test_plans: {
        data: {
          id: PLAN,
          name: "Evil plan",
          template_key: "custom",
          plan: { cases: [{ ...PLAN_CASE, script: "alert(1)" }] },
        },
        error: null,
      },
    });
    const res = await publishCommunityTemplate(WS, PROJECT, PLAN, { license: "MIT" });
    expect(res.ok).toBe(false);
    expect(db.ops.filter((o) => o.table === "community_templates")).toHaveLength(0);
  });

  it("denies non-members and returns NOT FOUND for missing plans", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const denied = await publishCommunityTemplate(WS, PROJECT, PLAN, { license: "MIT" });
    expect(denied.ok).toBe(false);

    setupDb({ test_plans: { data: null, error: null } });
    const missing = await publishCommunityTemplate(WS, PROJECT, PLAN, { license: "MIT" });
    expect(missing.ok === false && missing.error).toBe("Test plan not found.");
  });
});

describe("browse and preview", () => {
  it("lists published templates without content", async () => {
    setupDb({ community_templates: { data: [TEMPLATE_ROW], error: null } });
    const res = await listCommunityTemplates(WS, { search: "check" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]?.authorDisplayName).toBe("Ali QA");
    expect(JSON.stringify(res.data)).not.toContain("content");
  });

  it("previews validated content and counts the view via RPC", async () => {
    const db = setupDb();
    const res = await getCommunityTemplate(WS, TEMPLATE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.content.cases).toHaveLength(1);
    expect(db.rpcCalls).toEqual([
      { name: "bump_community_template_views", args: { p_template_id: TEMPLATE } },
    ]);
  });

  it("refuses to preview tampered stored content", async () => {
    setupDb({
      community_templates: {
        data: { ...TEMPLATE_ROW, content: { cases: [{ ...PLAN_CASE, eval: "x" }] } },
        error: null,
      },
    });
    const res = await getCommunityTemplate(WS, TEMPLATE);
    expect(res.ok).toBe(false);
  });
});

describe("importCommunityTemplate — isolation", () => {
  it("creates drafts in the importer's project, credits the author, never touches the template", async () => {
    const db = setupDb({}, OTHER_USER); // importer is not the author
    const res = await importCommunityTemplate(WS, PROJECT, TEMPLATE, {
      suiteName: "Checkout (imported)",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.caseCount).toBe(1);

    const suiteInsert = db.ops.find((o) => o.table === "suites" && o.op === "insert");
    const suitePayload = suiteInsert?.payload as { description: string; workspace_id: string };
    expect(suitePayload.workspace_id).toBe(WS);
    expect(suitePayload.description).toContain("Ali QA");
    expect(suitePayload.description).toContain("CC-BY-4.0");

    const caseInsert = db.ops.find((o) => o.table === "test_cases" && o.op === "insert");
    const rows = caseInsert?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.workspace_id).toBe(WS);
    expect(rows[0]?.created_by).toBe(OTHER_USER);

    // The template row itself is never updated by an import.
    expect(
      db.ops.filter((o) => o.table === "community_templates" && o.op !== "insert"),
    ).toHaveLength(0);
    expect(db.rpcCalls.map((c) => c.name)).toContain("bump_community_template_imports");
  });

  it("re-validates at import: tampered content imports nothing", async () => {
    const db = setupDb({
      community_templates: {
        data: {
          ...TEMPLATE_ROW,
          content: {
            cases: [{ ...PLAN_CASE, steps: [{ action: "page.evaluate(x)", expected: "y" }] }],
          },
        },
        error: null,
      },
    });
    const res = await importCommunityTemplate(WS, PROJECT, TEMPLATE, { suiteName: "X suite" });
    expect(res.ok).toBe(false);
    expect(db.ops.filter((o) => o.table === "suites")).toHaveLength(0);
    expect(db.ops.filter((o) => o.table === "test_cases")).toHaveLength(0);
  });

  it("denies imports into a workspace the user does not belong to", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await importCommunityTemplate(WS, PROJECT, TEMPLATE, { suiteName: "X suite" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("You don't have access to this workspace.");
  });
});

describe("reportCommunityTemplate", () => {
  it("records the report against the reporter", async () => {
    const db = setupDb({}, OTHER_USER);
    const res = await reportCommunityTemplate(WS, TEMPLATE, { reason: "spam" });
    expect(res.ok).toBe(true);
    const insert = db.ops.find((o) => o.table === "community_template_reports");
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload.template_id).toBe(TEMPLATE);
    expect(payload.reporter_user_id).toBe(OTHER_USER);
    expect(payload.reason).toBe("spam");
  });

  it("explains duplicate reports", async () => {
    setupDb({
      community_template_reports: { data: null, error: { code: "23505", message: "dup" } },
    });
    const res = await reportCommunityTemplate(WS, TEMPLATE, { reason: "spam" });
    expect(res.ok === false && res.error).toBe("You already reported this template.");
  });
});

describe("author management permissions", () => {
  it("lets the author unpublish and delete", async () => {
    const db = setupDb();
    const un = await unpublishCommunityTemplate(WS, TEMPLATE);
    expect(un.ok).toBe(true);
    expect(db.ops.some((o) => o.op === "update")).toBe(true);
    const del = await deleteCommunityTemplate(WS, TEMPLATE);
    expect(del.ok).toBe(true);
    expect(db.ops.some((o) => o.op === "delete")).toBe(true);
  });

  it("gives non-authors the same NOT FOUND as a missing template", async () => {
    const db = setupDb({}, OTHER_USER);
    const un = await unpublishCommunityTemplate(WS, TEMPLATE);
    expect(un.ok === false && un.error).toBe("Template not found.");
    const del = await deleteCommunityTemplate(WS, TEMPLATE);
    expect(del.ok).toBe(false);
    expect(db.ops.filter((o) => o.op === "update" || o.op === "delete")).toHaveLength(0);
  });
});
