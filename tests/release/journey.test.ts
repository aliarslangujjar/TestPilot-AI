/** @vitest-environment node */
/**
 * Release-readiness journey: the core first-run path exercised end to
 * end against one shared in-memory data plane —
 *
 *   create workspace → create project → create suite → manual case →
 *   mocked AI generation → human review (approve one, reject one) →
 *   only the approved case is saved.
 *
 * The authorization gate is the REAL requireWorkspaceClient +
 * assertWorkspaceMembership running against the fake backend (only
 * the Supabase transport is substituted), and the AI provider is
 * mocked — no paid calls, no production data. Cross-workspace and
 * signed-out denials are asserted on the same path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveReviewedCases } from "@/lib/ai-review/actions";
import { createProject } from "@/lib/projects/actions";
import { createSuite } from "@/lib/suites/actions";
import { createTestCase, listTestCases } from "@/lib/test-cases/actions";
import { generateTestPlan } from "@/lib/test-plans/actions";
import { createWorkspace } from "@/lib/workspaces/actions";

import { FakeAppDb, RELEASE_OTHER_USER, RELEASE_USER } from "./fake-app-db";

const db = new FakeAppDb();
const authState: { currentUser: { id: string; email: string } | null } = {
  currentUser: { id: RELEASE_USER, email: "qa@example.com" },
};
const generateStructuredMock = vi.fn();
const getAIStatusMock = vi.fn();

// The mock factories only build closures — the shared state above is
// read when the actions actually call in, after module init.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...db.client(),
    auth: {
      getUser: async () => ({ data: { user: authState.currentUser } }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => db.client(),
}));

vi.mock("@/lib/ai/service", () => ({
  generateStructured: (...args: unknown[]) => generateStructuredMock(...args),
  getAIStatus: (...args: unknown[]) => getAIStatusMock(...args),
}));

const PLAN_FIXTURE = {
  summary: "Login coverage: happy path, bad password, and lockout boundary.",
  cases: [
    {
      title: "Sign in with valid credentials",
      objective: "Verify the happy-path sign-in reaches the dashboard",
      preconditions: "A registered user exists",
      steps: [
        { action: "Submit the login form with valid credentials", expected: "Dashboard loads" },
      ],
      expectedResults: "The user lands on the dashboard",
      priority: "high",
      coverage: "positive",
      assumptions: [],
    },
    {
      title: "Sign in with a wrong password",
      objective: "Verify invalid credentials are rejected safely",
      preconditions: "A registered user exists",
      steps: [
        { action: "Submit the login form with a wrong password", expected: "Error is shown" },
      ],
      expectedResults: "A generic credential error is shown and no session is created",
      priority: "high",
      coverage: "negative",
      assumptions: [],
    },
    {
      title: "Lockout after repeated failures",
      objective: "Verify the account locks at the failed-attempt boundary",
      preconditions: "A registered user exists",
      steps: [{ action: "Fail sign-in repeatedly", expected: "Lockout message appears" }],
      expectedResults: "Further attempts are refused for the lockout window",
      priority: "medium",
      coverage: "boundary",
      assumptions: ["Lockout threshold is five attempts"],
    },
  ],
};

beforeEach(() => {
  db.tables.clear();
  db.ops.length = 0;
  authState.currentUser = { id: RELEASE_USER, email: "qa@example.com" };
  generateStructuredMock.mockReset();
  getAIStatusMock.mockReset();
  getAIStatusMock.mockResolvedValue({
    enabled: true,
    provider: "openai",
    model: "release-mock-model",
    demo: false,
  });
  generateStructuredMock.mockResolvedValue({
    data: PLAN_FIXTURE,
    usage: { inputTokens: 120, outputTokens: 340, costUsd: 0 },
  });
});

describe("release journey — first-run path", () => {
  it("runs workspace → project → suite → manual case → AI generation → reviewed save", async () => {
    // 1. Workspace (bootstraps the creator as owner in the fake).
    const ws = await createWorkspace({ name: "Release QA" });
    expect(ws.ok).toBe(true);
    if (!ws.ok) throw new Error(ws.error);
    const workspaceId = ws.data.id;
    const membership = db
      .rows("memberships")
      .find((m) => m.workspace_id === workspaceId && m.user_id === RELEASE_USER);
    expect(membership?.role).toBe("owner");

    // 2. Project + suite.
    const project = await createProject(workspaceId, {
      name: "Demo Shop",
      description: "Release-readiness target",
      baseUrl: "https://demo.example.com",
    });
    expect(project.ok).toBe(true);
    if (!project.ok) throw new Error(project.error);
    const projectId = project.data.id;

    const suite = await createSuite(workspaceId, projectId, { name: "Smoke", description: "" });
    expect(suite.ok).toBe(true);
    if (!suite.ok) throw new Error(suite.error);
    const suiteId = suite.data.id;

    // 3. A manual test case, written by a human.
    const manual = await createTestCase(workspaceId, projectId, suiteId, {
      title: "Manual: checkout totals include tax",
      description: "Hand-written release check",
      preconditions: "Cart contains one taxed item",
      steps: [{ action: "Open the cart", expected: "Total includes tax" }],
      expectedResults: "Displayed total equals subtotal plus tax",
      priority: "high",
      tags: ["manual"],
      status: "active",
    });
    expect(manual.ok).toBe(true);

    // 4. Mocked AI generation produces reviewable drafts (no paid call:
    //    the provider seam is the mock above).
    const generated = await generateTestPlan({
      workspaceId,
      sourceKind: "user_story",
      sourceText:
        "As a registered user I can sign in with email and password so that I can reach my dashboard.",
      maxCases: 3,
      includeNegative: true,
      includeBoundary: true,
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) throw new Error("generation failed");
    expect(generated.data.cases).toHaveLength(3);
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);

    // 5. Human review: approve the positive + negative drafts, reject
    //    the boundary draft (its lockout assumption is unverified).
    const drafts = generated.data.cases;
    const boundary = drafts.find((c) => c.coverage === "boundary");
    const approved = drafts.filter((c) => c.coverage !== "boundary");
    expect(boundary).toBeTruthy();

    const saved = await saveReviewedCases({
      workspaceId,
      projectId,
      suiteId,
      cases: drafts,
      approvedTempIds: approved.map((c) => c.tempId),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.created).toBe(2);

    // 6. The suite now holds the manual case + exactly the approved AI
    //    cases — the rejected draft never became a test case.
    const listed = await listTestCases(workspaceId, projectId, suiteId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error);
    const titles = listed.data.map((c) => c.title);
    expect(titles).toContain("Manual: checkout totals include tax");
    expect(titles).toContain("Sign in with valid credentials");
    expect(titles).toContain("Sign in with a wrong password");
    expect(titles).not.toContain("Lockout after repeated failures");
  });

  it("denies every step to a signed-out caller", async () => {
    const ws = await createWorkspace({ name: "Owned" });
    if (!ws.ok) throw new Error("setup failed");
    authState.currentUser = null;

    const denied = await createProject(ws.data.id, { name: "Nope" });
    expect(denied.ok).toBe(false);
    expect(db.rows("projects")).toHaveLength(0);
  });

  it("denies a non-member (cross-workspace) on the same actions", async () => {
    const ws = await createWorkspace({ name: "Owner workspace" });
    if (!ws.ok) throw new Error("setup failed");
    const workspaceId = ws.data.id;

    // A different signed-in user with no membership in this workspace.
    authState.currentUser = { id: RELEASE_OTHER_USER, email: "intruder@example.com" };

    const project = await createProject(workspaceId, { name: "Intruder project" });
    expect(project.ok).toBe(false);

    const generated = await generateTestPlan({
      workspaceId,
      sourceKind: "user_story",
      sourceText: "As a user I can do a perfectly reasonable thing in this app.",
      maxCases: 2,
      includeNegative: true,
      includeBoundary: true,
    });
    expect(generated.ok).toBe(false);
    // The AI provider is never reached for a denied caller.
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(db.rows("projects")).toHaveLength(0);
  });
});
