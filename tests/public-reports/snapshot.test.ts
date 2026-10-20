/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  buildRunSnapshot,
  isSnapshotStale,
  type SnapshotInput,
} from "@/lib/public-reports/snapshot";

const BASE: SnapshotInput = {
  projectName: "Shop",
  runName: "Nightly checkout",
  source: "automated",
  status: "completed",
  executionStatus: "failed",
  createdAt: "2026-10-20T00:00:00.000Z",
  completedAt: "2026-10-20T00:05:00.000Z",
  durationMs: 300_000,
  includeFailureDetails: false,
  summary: {
    total: 2,
    passed: 1,
    failed: 1,
    timedOut: 0,
    cancelled: 0,
    blocked: 0,
    skipped: 0,
    unexecuted: 0,
  },
  cases: [
    { title: "Home loads", status: "passed", durationMs: 1000 },
    {
      title: "Pay with card password=hunter2",
      status: "failed",
      durationMs: 2000,
      expected: 'role button "Pay" to be clickable',
      actual: "Bearer abcdefghijklmnopqrstuvwxyz0123456789 not found",
      failedStepAction: "click",
      analysis: {
        probableClassification: "locator_issue",
        confidence: 0.55,
        uncertainty: "Hypothesis only.",
      },
    },
  ],
  generatedAt: new Date("2026-10-20T01:00:00.000Z"),
};

describe("buildRunSnapshot — data leakage boundary", () => {
  it("redacts secret-shaped values from titles and evidence", () => {
    const snap = buildRunSnapshot({ ...BASE, includeFailureDetails: true });
    const json = JSON.stringify(snap);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(snap.cases[1]?.title).toContain("[redacted]");
  });

  it("contains no ids, logs, notes, or artifact fields at all", () => {
    const snap = buildRunSnapshot({ ...BASE, includeFailureDetails: true });
    const json = JSON.stringify(snap);
    expect(Object.keys(snap)).not.toContain("workspaceId");
    expect(json).not.toContain("artifact");
    expect(json).not.toContain("console");
    expect(json).not.toContain("network");
    expect(json).not.toContain("notes");
    expect(json).not.toContain("jobId");
  });

  it("omits failure details entirely when the owner did not opt in", () => {
    const snap = buildRunSnapshot(BASE); // includeFailureDetails: false
    expect(snap.cases[1]?.detail).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain("to be clickable");
  });

  it("includes sanitized expected/actual only for failed cases when opted in", () => {
    const snap = buildRunSnapshot({ ...BASE, includeFailureDetails: true });
    expect(snap.cases[0]?.detail).toBeUndefined(); // passed case: no detail
    const detail = snap.cases[1]?.detail;
    expect(detail?.expected).toContain("to be clickable");
    expect(detail?.failedStepAction).toBe("click");
    expect(detail?.probableClassification).toBe("locator_issue");
    expect(detail?.confidence).toBe(0.55);
  });

  it("records generation time and data-as-of separately", () => {
    const snap = buildRunSnapshot(BASE);
    expect(snap.generatedAt).toBe("2026-10-20T01:00:00.000Z");
    expect(snap.dataAsOf).toBe("2026-10-20T00:05:00.000Z");
  });
});

describe("isSnapshotStale", () => {
  it("flags data older than 24h and accepts fresh data", () => {
    const snap = buildRunSnapshot(BASE);
    expect(isSnapshotStale(snap, new Date("2026-10-20T02:00:00.000Z"))).toBe(false);
    expect(isSnapshotStale(snap, new Date("2026-10-22T00:00:00.000Z"))).toBe(true);
  });
});
