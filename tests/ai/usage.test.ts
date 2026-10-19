/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseAIConfig } from "@/lib/ai/config";
import { AIServiceError } from "@/lib/ai/errors";
import { checkQuota, getTodayUsage, logUsage } from "@/lib/ai/usage";

const WS_ID = "11111111-1111-4111-8111-111111111111";

const { adminFromMock } = vi.hoisted(() => ({ adminFromMock: vi.fn() }));

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

const config = parseAIConfig({});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTodayUsage", () => {
  it("returns zeros when there is no row yet", async () => {
    adminFromMock.mockImplementation(() => mockQuery({ data: null }));
    expect(await getTodayUsage(WS_ID)).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0 });
  });

  it("rejects malformed workspace ids", async () => {
    await expect(getTodayUsage("nope")).rejects.toBeInstanceOf(AIServiceError);
    expect(adminFromMock).not.toHaveBeenCalled();
  });
});

describe("checkQuota", () => {
  it("passes under the limits", async () => {
    adminFromMock.mockImplementation(() =>
      mockQuery({ data: { request_count: 3, input_tokens: 100, output_tokens: 50 } }),
    );
    await expect(checkQuota(WS_ID, config)).resolves.toBeUndefined();
  });

  it("throws AI_QUOTA_EXCEEDED at the request limit", async () => {
    adminFromMock.mockImplementation(() =>
      mockQuery({ data: { request_count: 100, input_tokens: 0, output_tokens: 0 } }),
    );
    const error = await checkQuota(WS_ID, config).catch((e) => e);
    expect(error).toBeInstanceOf(AIServiceError);
    expect(error.code).toBe("AI_QUOTA_EXCEEDED");
  });

  it("throws AI_QUOTA_EXCEEDED at the token limit", async () => {
    adminFromMock.mockImplementation(() =>
      mockQuery({ data: { request_count: 1, input_tokens: 150000, output_tokens: 50000 } }),
    );
    const error = await checkQuota(WS_ID, config).catch((e) => e);
    expect(error.code).toBe("AI_QUOTA_EXCEEDED");
  });
});

describe("logUsage", () => {
  it("upserts incremented counters for today", async () => {
    adminFromMock.mockImplementation(() =>
      mockQuery({ data: { request_count: 2, input_tokens: 100, output_tokens: 50 } }),
    );
    await logUsage(WS_ID, 30, 10);
    const row = (adminFromMock.mock.results.at(-1)?.value as { upsertArgs?: unknown[] })
      ?.upsertArgs?.[0] as Record<string, unknown>;
    expect(row.workspace_id).toBe(WS_ID);
    expect(row.request_count).toBe(3);
    expect(row.input_tokens).toBe(130);
    expect(row.output_tokens).toBe(60);
  });
});
