/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/r/[token]/route";

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));

vi.mock("@/lib/public-reports/access", () => ({
  resolvePublicReport: (...args: unknown[]) => resolveMock(...args),
}));

const TOKEN = "a".repeat(43);

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    projectName: "Shop",
    runName: "<script>alert(1)</script> Nightly",
    source: "automated",
    status: "completed",
    executionStatus: "failed",
    generatedAt: "2026-10-20T01:00:00.000Z",
    dataAsOf: "2026-10-20T00:05:00.000Z",
    durationMs: 60_000,
    includeFailureDetails: false,
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      timedOut: 0,
      cancelled: 0,
      blocked: 0,
      skipped: 0,
      unexecuted: 0,
    },
    cases: [{ title: "Case <b>one</b>", status: "failed", durationMs: 1000 }],
    ...overrides,
  };
}

function request() {
  return new Request(`https://example.com/r/${TOKEN}`, {
    headers: { "x-forwarded-for": "1.2.3.4" },
  });
}

async function call() {
  return GET(request(), { params: Promise.resolve({ token: TOKEN }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public report route", () => {
  it("renders the report with escaped user content and security headers", async () => {
    resolveMock.mockResolvedValue({ status: "ok", snapshot: snapshot(), noIndex: true });
    const res = await call();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Case &lt;b&gt;one&lt;/b&gt;");
    expect(html).toContain("Report generated");
    expect(html).toContain("Data as of");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("omits the noindex header when the owner allowed indexing", async () => {
    resolveMock.mockResolvedValue({ status: "ok", snapshot: snapshot(), noIndex: false });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("shows a stale indicator when the run data is over 24h old", async () => {
    resolveMock.mockResolvedValue({
      status: "ok",
      snapshot: snapshot({ dataAsOf: "2026-10-18T00:05:00.000Z" }),
      noIndex: true,
    });
    const res = await call();
    const html = await res.text();
    expect(html).toContain("may be stale");
  });

  it("returns a generic 404 for unknown/revoked/expired reports", async () => {
    resolveMock.mockResolvedValue({ status: "not_found" });
    const res = await call();
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Report not found");
    expect(html).not.toContain("Nightly");
  });

  it("returns 429 with Retry-After when rate-limited", async () => {
    resolveMock.mockResolvedValue({ status: "rate_limited", retryAfterSeconds: 42 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });
});
