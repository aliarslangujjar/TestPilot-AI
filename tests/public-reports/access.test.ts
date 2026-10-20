/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePublicReport } from "@/lib/public-reports/access";
import { resetRateLimits } from "@/lib/public-reports/rate-limit";
import { generateShareToken, hashShareToken } from "@/lib/public-reports/token";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClientMock(...args),
}));

const SNAPSHOT = {
  version: 1,
  projectName: "Shop",
  runName: "Nightly",
  source: "automated",
  status: "completed",
  executionStatus: "passed",
  generatedAt: "2026-10-20T01:00:00.000Z",
  dataAsOf: "2026-10-20T00:05:00.000Z",
  durationMs: 60_000,
  includeFailureDetails: false,
  summary: {
    total: 1,
    passed: 1,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    blocked: 0,
    skipped: 0,
    unexecuted: 0,
  },
  cases: [{ title: "Home loads", status: "passed", durationMs: 1000 }],
};

interface RowOverrides {
  revoked_at?: string | null;
  expires_at?: string | null;
  no_index?: boolean;
  snapshot?: unknown;
}

function adminMock(row: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  function chain() {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.update = vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch);
      return q;
    });
    q.maybeSingle = vi.fn(() => q);
    q.then = (resolve: (value: unknown) => void) => {
      // First select (by token_hash) returns the row; the view-count select
      // returns a count object. Distinguish by whether `row` looks like one.
      resolve({ data: row, error: null });
    };
    return q;
  }
  return { updates, from: vi.fn(() => chain()) };
}

function rowWith(overrides: RowOverrides = {}) {
  return {
    id: "report-1",
    snapshot: SNAPSHOT,
    no_index: true,
    expires_at: null,
    revoked_at: null,
    view_count: 3,
    ...overrides,
  };
}

const NOW = new Date("2026-10-20T02:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
});

describe("token generation and hashing", () => {
  it("generates 43-char base64url tokens and stable sha256 hashes", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).toBe(hashShareToken(token));
    expect(generateShareToken()).not.toBe(token);
  });
});

describe("resolvePublicReport", () => {
  it("serves the snapshot for a valid token and counts the view", async () => {
    const { updates, from } = adminMock(rowWith());
    createAdminClientMock.mockReturnValue({ from });
    const token = generateShareToken();
    const res = await resolvePublicReport(token, "1.2.3.4", NOW);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.snapshot.runName).toBe("Nightly");
    expect(res.noIndex).toBe(true);
    expect(updates.some((u) => "view_count" in u)).toBe(true);
  });

  it("treats revoked reports exactly like unknown ones", async () => {
    const revoked = adminMock(rowWith({ revoked_at: "2026-10-20T01:30:00.000Z" }));
    createAdminClientMock.mockReturnValue({ from: revoked.from });
    const token = generateShareToken();
    const revokedRes = await resolvePublicReport(token, "1.2.3.4", NOW);

    const unknown = adminMock(null);
    createAdminClientMock.mockReturnValue({ from: unknown.from });
    const unknownRes = await resolvePublicReport(token, "1.2.3.4", NOW);

    expect(revokedRes).toEqual({ status: "not_found" });
    expect(unknownRes).toEqual({ status: "not_found" });
    expect(revokedRes).toEqual(unknownRes);
  });

  it("treats expired reports as not found", async () => {
    const { from } = adminMock(rowWith({ expires_at: "2026-10-20T01:00:00.000Z" }));
    createAdminClientMock.mockReturnValue({ from });
    const res = await resolvePublicReport(generateShareToken(), "1.2.3.4", NOW);
    expect(res).toEqual({ status: "not_found" });
  });

  it("rejects malformed tokens without touching the database", async () => {
    createAdminClientMock.mockReturnValue({ from: vi.fn() });
    for (const bad of ["short", "../etc/passwd", "a".repeat(44), ""]) {
      const res = await resolvePublicReport(bad, "1.2.3.4", NOW);
      expect(res).toEqual({ status: "not_found" });
    }
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("rate-limits after 30 reads per token+IP within a minute", async () => {
    const { from } = adminMock(rowWith());
    createAdminClientMock.mockReturnValue({ from });
    const token = generateShareToken();
    let last = await resolvePublicReport(token, "1.2.3.4", NOW);
    for (let i = 0; i < 30; i++) {
      last = await resolvePublicReport(token, "1.2.3.4", NOW);
    }
    expect(last.status).toBe("rate_limited");
    if (last.status === "rate_limited") expect(last.retryAfterSeconds).toBeGreaterThan(0);

    // A different IP is not affected by the first IP's limit.
    const other = await resolvePublicReport(token, "5.6.7.8", NOW);
    expect(other.status).toBe("ok");
  });

  it("returns not_found for a corrupted stored snapshot", async () => {
    const { from } = adminMock(rowWith({ snapshot: { garbage: true } }));
    createAdminClientMock.mockReturnValue({ from });
    const res = await resolvePublicReport(generateShareToken(), "1.2.3.4", NOW);
    expect(res).toEqual({ status: "not_found" });
  });
});
