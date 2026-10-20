/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  currentPeriodStart,
  firstExceededResource,
  FREE_LIMIT_DEFAULTS,
  getUsageLimits,
  periodEndFor,
  periodStartFor,
  wouldExceed,
} from "@/lib/usage/limits";

describe("getUsageLimits", () => {
  it("returns the free-plan defaults without env", () => {
    expect(getUsageLimits({})).toEqual(FREE_LIMIT_DEFAULTS);
  });

  it("honors valid env overrides and ignores invalid ones", () => {
    const limits = getUsageLimits({
      USAGE_FREE_AI_CALLS: "50",
      USAGE_FREE_BROWSER_RUNS: "abc",
      USAGE_FREE_EXECUTION_SECONDS: "-5",
      USAGE_FREE_STORAGE_BYTES: "1048576",
    });
    expect(limits.aiCalls).toBe(50);
    expect(limits.browserRuns).toBe(FREE_LIMIT_DEFAULTS.browserRuns);
    expect(limits.executionSeconds).toBe(FREE_LIMIT_DEFAULTS.executionSeconds);
    expect(limits.storageBytes).toBe(1048576);
  });
});

describe("period math (monthly, UTC)", () => {
  it("computes period starts and ends across month and year boundaries", () => {
    expect(periodStartFor(new Date("2026-10-20T15:00:00Z"))).toBe("2026-10-01");
    expect(periodStartFor(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01-01");
    expect(periodEndFor("2026-10-01")).toBe("2026-11-01");
    expect(periodEndFor("2026-12-01")).toBe("2027-01-01");
    expect(currentPeriodStart(new Date("2026-02-01T00:00:00Z"))).toBe("2026-02-01");
  });
});

describe("quota boundaries", () => {
  it("allows usage exactly at the limit and denies one unit over", () => {
    expect(wouldExceed(199, 1, 200)).toBe(false); // lands exactly on the limit
    expect(wouldExceed(200, 1, 200)).toBe(true); // one over
    expect(wouldExceed(0, 200, 200)).toBe(false);
    expect(wouldExceed(0, 201, 200)).toBe(true);
    expect(wouldExceed(200, 0, 200)).toBe(false); // zero amount never exceeds
  });

  it("identifies the first exceeded resource for error copy", () => {
    const usage = { aiCalls: 200, browserRuns: 0, executionSeconds: 0, storageBytes: 0 };
    const limits = { aiCalls: 200, browserRuns: 100, executionSeconds: 3600, storageBytes: 1000 };
    expect(firstExceededResource(usage, { aiCalls: 1 }, limits)).toBe("aiCalls");
    expect(firstExceededResource(usage, { browserRuns: 5 }, limits)).toBeNull();
    expect(firstExceededResource(usage, { browserRuns: 5, executionSeconds: 3601 }, limits)).toBe(
      "executionSeconds",
    );
  });
});
