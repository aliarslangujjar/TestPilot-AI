/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AIServiceError } from "@/lib/ai/errors";
import { generateStructured, getAIStatus } from "@/lib/ai/service";

const WS_ID = "11111111-1111-4111-8111-111111111111";

const {
  generateObjectMock,
  requireWorkspaceClientMock,
  adminFromMock,
  APICallError,
  TypeValidationError,
} = vi.hoisted(() => {
  class APICallError extends Error {
    statusCode: number;
    constructor(opts: { statusCode: number; message?: string }) {
      super(opts.message ?? "api call error");
      this.statusCode = opts.statusCode;
    }
  }
  class TypeValidationError extends Error {}
  class NoObjectGeneratedError extends Error {}
  class JSONParseError extends Error {}
  class LoadAPIKeyError extends Error {}
  return {
    generateObjectMock: vi.fn(),
    requireWorkspaceClientMock: vi.fn(),
    adminFromMock: vi.fn(),
    APICallError,
    TypeValidationError,
    NoObjectGeneratedError,
    JSONParseError,
    LoadAPIKeyError,
  };
});

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
  APICallError,
  TypeValidationError,
  NoObjectGeneratedError: class extends Error {},
  JSONParseError: class extends Error {},
  LoadAPIKeyError: class extends Error {},
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}));

function mockQuery(result: { data?: unknown; error?: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "maybeSingle", "upsert"]) {
    q[m] = vi.fn((...args: unknown[]) => {
      if (m === "upsert") {
        (q as { upsertArgs?: unknown[] }).upsertArgs = args;
        return Promise.resolve({ data: null, error: null });
      }
      return q;
    });
  }
  q.then = (resolve: (value: unknown) => void) =>
    resolve({ data: result.data ?? null, error: result.error ?? null });
  return q;
}

const summarySchema = z.object({ summary: z.string(), keyPoints: z.array(z.string()) });

const savedEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_MODEL;
  requireWorkspaceClientMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
  // Today's usage row: empty.
  adminFromMock.mockImplementation(() => mockQuery({ data: null, error: null }));
  generateObjectMock.mockResolvedValue({
    object: { summary: "All good.", keyPoints: ["a", "b"] },
    usage: { inputTokens: 120, outputTokens: 40 },
  });
});

describe("generateStructured", () => {
  const base = {
    workspaceId: WS_ID,
    system: "Summarize.",
    prompt: "Run notes here.",
    schema: summarySchema,
  };

  it("returns validated data and logs usage — never passing tools to the model", async () => {
    const result = await generateStructured(base);

    expect(result.data).toEqual({ summary: "All good.", keyPoints: ["a", "b"] });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40 });

    const call = generateObjectMock.mock.calls[0]?.[0] as
      { maxRetries?: unknown; abortSignal?: unknown } | undefined;
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty("tools");
    expect(call?.maxRetries).toBe(2);
    expect(call?.abortSignal).toBeInstanceOf(AbortSignal);

    // Usage upserted with incremented counts.
    const upsertArgs = (adminFromMock.mock.results.at(-1)?.value as { upsertArgs?: unknown[] })
      ?.upsertArgs?.[0] as Record<string, unknown>;
    expect(upsertArgs.request_count).toBe(1);
    expect(upsertArgs.input_tokens).toBe(120);
    expect(upsertArgs.output_tokens).toBe(40);
  });

  it("proves membership before anything else", async () => {
    requireWorkspaceClientMock.mockRejectedValue(new Error("denied"));
    await expect(generateStructured(base)).rejects.toThrow("denied");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input without calling the provider", async () => {
    const error = await generateStructured({ ...base, workspaceId: "not-a-uuid" }).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_INPUT_TOO_LONG");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("is disabled without an API key", async () => {
    delete process.env.OPENAI_API_KEY;
    const error = await generateStructured(base).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_DISABLED");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("enforces the per-workspace daily request quota", async () => {
    adminFromMock.mockImplementation(() =>
      mockQuery({ data: { request_count: 100, input_tokens: 10, output_tokens: 10 }, error: null }),
    );
    const error = await generateStructured(base).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_QUOTA_EXCEEDED");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("enforces the per-workspace daily token quota", async () => {
    adminFromMock.mockImplementation(() =>
      mockQuery({
        data: { request_count: 1, input_tokens: 199999, output_tokens: 1 },
        error: null,
      }),
    );
    const error = await generateStructured(base).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_QUOTA_EXCEEDED");
  });

  it("maps provider failures to typed retryable errors", async () => {
    generateObjectMock.mockRejectedValue(new APICallError({ statusCode: 429 }));
    const error = await generateStructured(base).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.retryable).toBe(true);
  });

  it("maps timeouts to AI_TIMEOUT", async () => {
    generateObjectMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const error = await generateStructured(base).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("maps malformed model output to AI_INVALID_RESPONSE", async () => {
    generateObjectMock.mockRejectedValue(new TypeValidationError("bad shape"));
    const error = await generateStructured(base).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_INVALID_RESPONSE");
    expect(error.retryable).toBe(false);
  });
});

describe("getAIStatus", () => {
  it("reports provider and model without secrets", async () => {
    const status = await getAIStatus();
    expect(status).toEqual({ enabled: true, provider: "openai", model: "gpt-4o-mini" });
  });

  it("reports disabled without a key", async () => {
    delete process.env.OPENAI_API_KEY;
    const status = await getAIStatus();
    expect(status.enabled).toBe(false);
  });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});
