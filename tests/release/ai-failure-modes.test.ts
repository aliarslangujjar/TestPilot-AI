/** @vitest-environment node */
/**
 * Release-readiness scenarios: AI failure modes.
 *
 * - Provider outage during generation: the real AI service surfaces a
 *   typed AIServiceError and RELEASES the usage reservation it took
 *   before the call (no quota is burned by a failed provider).
 * - Permission failure: a non-member never reaches the provider.
 * - Failure analysis with AI disabled: the deterministic fallback is
 *   produced, stored, and labelled (source "fallback", capped
 *   confidence) — never presented as AI output.
 * - Failure analysis during an outage: a clean error is returned and
 *   NOTHING is stored on the result.
 *
 * The provider SDK is mocked at the `ai` module seam — no paid calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { analyzeRunFailure } from "@/lib/ai-analysis/actions";
import { AIServiceError } from "@/lib/ai/errors";
import { generateStructured } from "@/lib/ai/service";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

import { FakeAppDb, RELEASE_USER } from "./fake-app-db";

const W = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const RESULT = "66666666-6666-4666-8666-666666666666";
const JOB = "77777777-7777-4777-8777-777777777777";

const db = new FakeAppDb();
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const generateObjectMock = vi.fn();
const requireWorkspaceClientMock = vi.fn();

const { APICallError } = vi.hoisted(() => {
  class APICallError extends Error {
    statusCode: number;
    constructor(statusCode: number, message?: string) {
      super(message ?? "api call error");
      this.statusCode = statusCode;
    }
  }
  return { APICallError };
});

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
  APICallError,
  TypeValidationError: class extends Error {},
  NoObjectGeneratedError: class extends Error {},
  JSONParseError: class extends Error {},
  LoadAPIKeyError: class extends Error {},
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => db.client().from(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: fn === "reserve_usage" ? true : null, error: null };
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const savedEnv = { ...process.env };

function seedFailedRun(): void {
  db.seed("test_runs", [{ id: RUN, workspace_id: W, project_id: P, source: "automated" }]);
  db.seed("run_results", [
    {
      id: RESULT,
      workspace_id: W,
      run_id: RUN,
      execution_status: "failed",
      snapshot: { title: "Sign in with valid credentials", expectedResults: "Dashboard loads" },
      browser_job_id: JOB,
      failure_analysis: null,
    },
  ]);
  db.seed("browser_jobs", [
    {
      id: JOB,
      workspace_id: W,
      status: "failed",
      failure_kind: "assertion",
      attempts: 1,
      error: "Step failed.",
      plan: {
        version: "1",
        name: "Login flow",
        baseUrl: "https://demo.example.com",
        allowedHosts: ["demo.example.com"],
        steps: [
          { action: "goto", url: "/login" },
          {
            action: "assertText",
            locator: { by: "role", role: "heading" },
            text: "Dashboard",
          },
        ],
      },
      result: {
        status: "failed",
        steps: [
          { index: 0, action: "goto", ok: true, durationMs: 120 },
          {
            index: 1,
            action: "assertText",
            ok: false,
            durationMs: 640,
            error: "Text mismatch: expected 'Dashboard' to be visible.",
          },
        ],
        artifacts: [],
        startedAt: "2026-10-20T10:00:00.000Z",
        finishedAt: "2026-10-20T10:00:01.000Z",
      },
    },
  ]);
}

beforeEach(() => {
  db.tables.clear();
  rpcCalls.length = 0;
  generateObjectMock.mockReset();
  requireWorkspaceClientMock.mockReset();
  requireWorkspaceClientMock.mockResolvedValue({ supabase: db.client(), userId: RELEASE_USER });
  delete process.env.AI_DEMO_MODE;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const summarySchema = z.object({ summary: z.string() });

describe("release scenario — AI provider outage (generation)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "release-test-dummy-key";
  });

  it("surfaces a typed error and releases the reserved usage", async () => {
    generateObjectMock.mockRejectedValue(new APICallError(503, "provider unavailable"));
    await expect(
      generateStructured({
        workspaceId: W,
        system: "You write test cases.",
        prompt: "Write one case for login.",
        schema: summarySchema,
        label: "release-outage",
      }),
    ).rejects.toBeInstanceOf(AIServiceError);
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).toContain("reserve_usage");
    expect(fns).toContain("release_usage");
    expect(fns.indexOf("release_usage")).toBeGreaterThan(fns.indexOf("reserve_usage"));
    expect(fns).not.toContain("meter_usage");
  });

  it("never calls the provider for a caller without workspace membership", async () => {
    requireWorkspaceClientMock.mockRejectedValue(new WorkspaceAccessDeniedError(W, "not a member"));
    await expect(
      generateStructured({
        workspaceId: W,
        system: "You write test cases.",
        prompt: "Write one case for login.",
        schema: summarySchema,
        label: "release-denied",
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("release scenario — failure analysis modes", () => {
  it("stores the deterministic fallback when AI is disabled (labelled, capped confidence)", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_PROVIDER = "openai";
    seedFailedRun();

    const res = await analyzeRunFailure(W, P, RUN, RESULT);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.source).toBe("fallback");
    expect(res.data.model).toBeNull();
    expect(res.data.analysis.confidence).toBeLessThanOrEqual(0.6);
    expect(generateObjectMock).not.toHaveBeenCalled();

    const stored = db.rows("run_results")[0];
    expect(stored?.failure_analysis_source).toBe("fallback");
    expect(stored?.failure_analysis).toBeTruthy();
  });

  it("returns a clean error and stores nothing when the provider is down", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "release-test-dummy-key";
    seedFailedRun();
    generateObjectMock.mockRejectedValue(new APICallError(503, "provider unavailable"));

    const res = await analyzeRunFailure(W, P, RUN, RESULT);
    expect(res.ok).toBe(false);
    const stored = db.rows("run_results")[0];
    expect(stored?.failure_analysis).toBeNull();
    expect(stored?.failure_analysis_source).toBeUndefined();
  });

  it("refuses to analyze a result that did not fail", async () => {
    delete process.env.OPENAI_API_KEY;
    seedFailedRun();
    db.rows("run_results")[0]!.execution_status = "passed";
    const res = await analyzeRunFailure(W, P, RUN, RESULT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Only failed or timed-out/);
  });
});
