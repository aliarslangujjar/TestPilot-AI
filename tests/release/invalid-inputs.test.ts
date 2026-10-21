/** @vitest-environment node */
/**
 * Release-readiness scenario: invalid-input matrix across the
 * journey's server actions. Every case must fail with ok:false AND
 * write nothing — validation happens before the data plane is
 * touched for writes (asserted via the fake's row counts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveReviewedCases } from "@/lib/ai-review/actions";
import { enqueueBrowserJob } from "@/lib/browser-jobs/actions";
import { createProject } from "@/lib/projects/actions";
import { createPublicReport } from "@/lib/public-reports/actions";
import { createSuite } from "@/lib/suites/actions";
import { createTestCase } from "@/lib/test-cases/actions";
import { generateTestPlan } from "@/lib/test-plans/actions";
import { createWorkspace } from "@/lib/workspaces/actions";

import { FakeAppDb, RELEASE_USER } from "./fake-app-db";

const db = new FakeAppDb();
const authState: { currentUser: { id: string; email: string } | null } = {
  currentUser: { id: RELEASE_USER, email: "qa@example.com" },
};
const generateStructuredMock = vi.fn();
const getAIStatusMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...db.client(),
    auth: { getUser: async () => ({ data: { user: authState.currentUser } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => db.client(),
}));
vi.mock("@/lib/ai/service", () => ({
  generateStructured: (...args: unknown[]) => generateStructuredMock(...args),
  getAIStatus: (...args: unknown[]) => getAIStatusMock(...args),
}));

let workspaceId = "";
let projectId = "";
let suiteId = "";

beforeEach(async () => {
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

  const ws = await createWorkspace({ name: "Matrix" });
  if (!ws.ok) throw new Error("setup: workspace");
  workspaceId = ws.data.id;
  const project = await createProject(workspaceId, { name: "Demo Shop" });
  if (!project.ok) throw new Error("setup: project");
  projectId = project.data.id;
  const suite = await createSuite(workspaceId, projectId, { name: "Smoke" });
  if (!suite.ok) throw new Error("setup: suite");
  suiteId = suite.data.id;
  db.ops.length = 0;
});

describe("release scenario — invalid inputs write nothing", () => {
  it("rejects empty and whitespace-only names at every level", async () => {
    expect((await createWorkspace({ name: "   " })).ok).toBe(false);
    expect((await createProject(workspaceId, { name: "" })).ok).toBe(false);
    expect((await createSuite(workspaceId, projectId, { name: "  " })).ok).toBe(false);
    expect(db.rows("workspaces")).toHaveLength(1); // only the setup one
    expect(db.rows("projects")).toHaveLength(1);
    expect(db.rows("suites")).toHaveLength(1);
  });

  it("rejects non-http(s) project base URLs (javascript:, ftp:, protocol-relative)", async () => {
    for (const baseUrl of [
      "javascript:alert(1)",
      "ftp://files.example.com",
      "//evil.example.com",
    ]) {
      const res = await createProject(workspaceId, { name: "Bad URL", baseUrl });
      expect(res.ok).toBe(false);
    }
    expect(db.rows("projects")).toHaveLength(1);
  });

  it("rejects malformed manual test cases", async () => {
    // "urgent" is not a valid priority — cast past the type to prove
    // the runtime schema rejects it too (defense in depth).
    const badPriority = await createTestCase(workspaceId, projectId, suiteId, {
      title: "Valid title",
      steps: [{ action: "a", expected: "b" }],
      expectedResults: "r",
      priority: "urgent" as never,
    });
    expect(badPriority.ok).toBe(false);
    const emptyTitle = await createTestCase(workspaceId, projectId, suiteId, {
      title: " ",
      steps: [{ action: "a", expected: "b" }],
      expectedResults: "r",
    });
    expect(emptyTitle.ok).toBe(false);
    // Note: an empty steps list is valid by design (cases can be
    // drafted before steps are written) — what is rejected is a step
    // with an empty action, and more steps than the cap.
    const emptyAction = await createTestCase(workspaceId, projectId, suiteId, {
      title: "Valid title",
      steps: [{ action: "  ", expected: "b" }],
      expectedResults: "r",
    });
    expect(emptyAction.ok).toBe(false);
    const tooManySteps = await createTestCase(workspaceId, projectId, suiteId, {
      title: "Valid title",
      steps: Array.from({ length: 101 }, () => ({ action: "a", expected: "b" })),
      expectedResults: "r",
    });
    expect(tooManySteps.ok).toBe(false);
    expect(db.rows("test_cases")).toHaveLength(0);
  });

  it("rejects bad AI-generation requests before the provider is called", async () => {
    const tooShort = await generateTestPlan({
      workspaceId,
      sourceKind: "user_story",
      sourceText: "too short",
      maxCases: 3,
      includeNegative: true,
      includeBoundary: true,
    });
    expect(tooShort.ok).toBe(false);
    const zeroCases = await generateTestPlan({
      workspaceId,
      sourceKind: "user_story",
      sourceText: "A long enough description of the feature under test for a plan.",
      maxCases: 0,
      includeNegative: true,
      includeBoundary: true,
    });
    expect(zeroCases.ok).toBe(false);
    const badWorkspace = await generateTestPlan({
      workspaceId: "not-a-uuid",
      sourceKind: "user_story",
      sourceText: "A long enough description of the feature under test for a plan.",
      maxCases: 3,
      includeNegative: true,
      includeBoundary: true,
    });
    expect(badWorkspace.ok).toBe(false);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("rejects a review submission approving a case that is not in it", async () => {
    const res = await saveReviewedCases({
      workspaceId,
      projectId,
      suiteId,
      cases: [
        {
          tempId: "11111111-1111-4111-8111-111111111111",
          title: "A generated case",
          description: "",
          preconditions: "",
          steps: [{ action: "a", expected: "b" }],
          expectedResults: "r",
          priority: "medium",
          tags: [],
          objective: "",
          coverage: "positive",
          assumptions: [],
        },
      ],
      approvedTempIds: ["22222222-2222-4222-8222-222222222222"],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/missing from the submission/);
    expect(db.rows("test_cases")).toHaveLength(0);
  });

  it("rejects an unsupported public-report expiry and an unsafe browser plan", async () => {
    const badExpiry = await createPublicReport(
      workspaceId,
      projectId,
      "55555555-5555-4555-8555-555555555555",
      {
        expiresInDays: 14,
      },
    );
    expect(badExpiry.ok).toBe(false);
    expect(db.rows("public_reports")).toHaveLength(0);

    const badPlan = await enqueueBrowserJob({
      workspaceId,
      projectId,
      plan: {
        version: "1",
        name: "File oracle",
        baseUrl: "file:///etc/passwd",
        allowedHosts: ["example.com"],
        steps: [{ action: "goto", url: "/" }],
      },
    });
    expect(badPlan.ok).toBe(false);
    expect(db.rows("browser_jobs")).toHaveLength(0);
  });
});
