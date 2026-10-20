/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { currentPeriodStart, FREE_LIMIT_DEFAULTS } from "@/lib/usage/limits";
import { getUsageCounters, meterUsage, releaseUsage, reserveUsage } from "@/lib/usage/usage";

const WS = "11111111-1111-4111-8111-111111111111";

const { createAdminClientMock, rpcMock, fromMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClientMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });
  rpcMock.mockResolvedValue({ data: true, error: null });
});

describe("reserveUsage — the concurrency contract", () => {
  it("passes amounts and limits to the atomic reserve RPC for the current period", async () => {
    const ok = await reserveUsage(WS, { aiCalls: 1 });
    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("reserve_usage", {
      p_workspace_id: WS,
      p_period_start: currentPeriodStart(),
      p_ai_calls: 1,
      p_browser_runs: 0,
      p_execution_seconds: 0,
      p_storage_bytes: 0,
      p_ai_limit: FREE_LIMIT_DEFAULTS.aiCalls,
      p_browser_runs_limit: FREE_LIMIT_DEFAULTS.browserRuns,
      p_execution_seconds_limit: FREE_LIMIT_DEFAULTS.executionSeconds,
      p_storage_limit: FREE_LIMIT_DEFAULTS.storageBytes,
    });
  });

  it("returns false ONLY on an explicit quota denial from the RPC", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await reserveUsage(WS, { browserRuns: 3 })).toBe(false);
  });

  it("fails open on infrastructure errors (metering outage must not block work)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect(await reserveUsage(WS, { aiCalls: 1 })).toBe(true);
    rpcMock.mockRejectedValue(new Error("network"));
    expect(await reserveUsage(WS, { aiCalls: 1 })).toBe(true);
  });
});

describe("releaseUsage / meterUsage", () => {
  it("calls the matching RPCs with zero-filled amounts", async () => {
    await releaseUsage(WS, { browserRuns: 2 });
    expect(rpcMock).toHaveBeenCalledWith(
      "release_usage",
      expect.objectContaining({ p_browser_runs: 2, p_ai_calls: 0 }),
    );
    await meterUsage(WS, { executionSeconds: 90 });
    expect(rpcMock).toHaveBeenCalledWith(
      "meter_usage",
      expect.objectContaining({ p_execution_seconds: 90 }),
    );
  });

  it("swallows RPC failures (best effort)", async () => {
    rpcMock.mockRejectedValue(new Error("down"));
    await expect(releaseUsage(WS, { aiCalls: 1 })).resolves.toBeUndefined();
    await expect(meterUsage(WS, { executionSeconds: 1 })).resolves.toBeUndefined();
  });
});

describe("getUsageCounters", () => {
  it("maps the counter row and defaults to zeros when absent", async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() => chain),
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: {
            period_start: currentPeriodStart(),
            ai_calls: 7,
            browser_runs: 3,
            execution_seconds: 120,
            storage_bytes: 2048,
          },
          error: null,
        }),
    };
    fromMock.mockReturnValue(chain);
    expect(await getUsageCounters(WS)).toEqual({
      aiCalls: 7,
      browserRuns: 3,
      executionSeconds: 120,
      storageBytes: 2048,
    });

    const emptyChain = {
      select: vi.fn(() => emptyChain),
      eq: vi.fn(() => emptyChain),
      maybeSingle: vi.fn(() => emptyChain),
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    };
    fromMock.mockReturnValue(emptyChain);
    expect(await getUsageCounters(WS)).toEqual({
      aiCalls: 0,
      browserRuns: 0,
      executionSeconds: 0,
      storageBytes: 0,
    });
  });
});
