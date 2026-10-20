/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildDemoObject } from "@/lib/ai/demo";
import { AIServiceError } from "@/lib/ai/errors";
import { generateStructured, getAIStatus } from "@/lib/ai/service";
import { failureAnalysisSchema } from "@schemas/ai-analysis";
import { generatedPlanSchema } from "@schemas/test-plan";

const WS = "11111111-1111-4111-8111-111111111111";

const { generateObjectMock, requireWorkspaceClientMock, reserveMock, releaseMock } = vi.hoisted(
  () => ({
    generateObjectMock: vi.fn(),
    requireWorkspaceClientMock: vi.fn(),
    reserveMock: vi.fn(),
    releaseMock: vi.fn(),
  }),
);

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
  APICallError: class extends Error {},
  TypeValidationError: class extends Error {},
  NoObjectGeneratedError: class extends Error {},
  JSONParseError: class extends Error {},
  LoadAPIKeyError: class extends Error {},
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/usage/usage", () => ({
  reserveUsage: (...args: unknown[]) => reserveMock(...args),
  releaseUsage: (...args: unknown[]) => releaseMock(...args),
  meterUsage: vi.fn(async () => {}),
  getUsageCounters: vi.fn(async () => ({
    aiCalls: 0,
    browserRuns: 0,
    executionSeconds: 0,
    storageBytes: 0,
  })),
  getUsageHistory: vi.fn(async () => []),
  syncStorageUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "maybeSingle", "upsert"]) q[m] = vi.fn(() => q);
      q.then = (resolve: (v: unknown) => void) =>
        resolve({ data: { requests: 0, input_tokens: 0, output_tokens: 0 }, error: null });
      return q;
    },
  }),
}));

const simpleSchema = z.object({ title: z.string().min(2), count: z.number().int() });

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceClientMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
  reserveMock.mockResolvedValue(true);
  releaseMock.mockResolvedValue(undefined);
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.AI_DEMO_MODE;
});

afterEach(() => {
  delete process.env.AI_DEMO_MODE;
});

describe("buildDemoObject (demo generator)", () => {
  it("produces output that parses against the real plan-generation schema", () => {
    const plan = buildDemoObject(generatedPlanSchema);
    expect(plan.cases.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).toContain("Demo");
  });

  it("produces output that parses against the failure-analysis schema", () => {
    const analysis = buildDemoObject(failureAnalysisSchema);
    expect(analysis.uncertainty.length).toBeGreaterThan(0);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0);
    expect(analysis.confidence).toBeLessThanOrEqual(1);
  });

  it("handles optional/default/union/literal/uuid fields", () => {
    const schema = z.object({
      id: z.uuid(),
      kind: z.literal("demo"),
      mode: z.union([z.literal("a"), z.literal("b")]),
      maybe: z.string().optional(),
      withDefault: z.number().default(3),
      flag: z.boolean(),
    });
    const value = buildDemoObject(schema);
    expect(value.kind).toBe("demo");
    expect(value.mode).toBe("a");
    expect(() => z.uuid().parse(value.id)).not.toThrow();
  });
});

describe("generateStructured — period quota + demo mode", () => {
  it("rejects gracefully at the period quota without calling the provider", async () => {
    reserveMock.mockResolvedValue(false);
    await expect(
      generateStructured({ workspaceId: WS, system: "s", prompt: "p", schema: simpleSchema }),
    ).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("releases the reservation when the provider call fails", async () => {
    generateObjectMock.mockRejectedValue(new Error("provider down"));
    await expect(
      generateStructured({ workspaceId: WS, system: "s", prompt: "p", schema: simpleSchema }),
    ).rejects.toBeInstanceOf(AIServiceError);
    expect(releaseMock).toHaveBeenCalledWith(WS, { aiCalls: 1 });
  });

  it("demo mode returns schema-valid sample data with no provider call and no API key", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_DEMO_MODE = "true";
    const res = await generateStructured({
      workspaceId: WS,
      system: "s",
      prompt: "p",
      schema: simpleSchema,
    });
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(res.data.title).toContain("Demo");
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });

    const status = await getAIStatus();
    expect(status).toMatchObject({ enabled: true, demo: true, model: "demo" });
  });
});
