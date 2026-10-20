/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportError } from "@/lib/observability/report";
import { resetRateLimits } from "@/lib/public-reports/rate-limit";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as errorReportPOST } from "@/app/api/error-report/route";

const { getAIStatusMock } = vi.hoisted(() => ({ getAIStatusMock: vi.fn() }));
vi.mock("@/lib/ai/service", () => ({
  getAIStatus: (...args: unknown[]) => getAIStatusMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  getAIStatusMock.mockResolvedValue({
    enabled: false,
    provider: "openai",
    model: "m",
    demo: false,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("health endpoint", () => {
  it("reports degraded + not_configured when Supabase env is absent", async () => {
    const res = await healthGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("not_configured");
    expect(body.checks.ai).toBe("disabled");
  });

  it("reports ok when the Supabase auth health endpoint answers (and never follows redirects)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    getAIStatusMock.mockResolvedValue({
      enabled: true,
      provider: "openai",
      model: "m",
      demo: false,
    });
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await healthGET();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual({ database: "ok", ai: "ok" });
    // Audit regression: the probe carries the apikey header and must not
    // be redirectable to another host.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/v1/health"),
      expect.objectContaining({ redirect: "manual" }),
    );
    vi.unstubAllGlobals();
  });

  it("reports unreachable when the auth health fetch fails, and demo for AI demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    getAIStatusMock.mockResolvedValue({
      enabled: true,
      provider: "openai",
      model: "demo",
      demo: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const res = await healthGET();
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks).toEqual({ database: "unreachable", ai: "demo" });
    vi.unstubAllGlobals();
  });
});

describe("reportError", () => {
  it("emits one structured JSON line and returns a report id", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = reportError(new Error("boom"), { route: "/dashboard", action: "test" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({
      level: "error",
      reportId: id,
      name: "Error",
      message: "boom",
      route: "/dashboard",
    });
    spy.mockRestore();
  });

  it("caps long messages and never includes non-allowlisted context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("x".repeat(900)), { route: "/a" });
    const entry = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(entry.message.length).toBeLessThanOrEqual(501);
    expect(Object.keys(entry)).not.toContain("headers");
    spy.mockRestore();
  });
});

describe("error-report beacon", () => {
  it("rate-limits floods per client IP (audit regression)", async () => {
    resetRateLimits();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const post = (ip: string) =>
      errorReportPOST(
        new Request("http://localhost/api/error-report", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ message: "flood" }),
        }),
      );
    for (let i = 0; i < 30; i++) {
      expect((await post("203.0.113.9")).status).toBe(200);
    }
    const blocked = await post("203.0.113.9");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    // A different source is unaffected.
    expect((await post("203.0.113.10")).status).toBe(200);
    spy.mockRestore();
    resetRateLimits();
  });

  it("accepts a capped payload and returns a report id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await errorReportPOST(
      new Request("http://localhost/api/error-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "client boom", route: "/dashboard", digest: "d1" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reportId).toMatch(/^[0-9a-f-]{36}$/);
    spy.mockRestore();
  });

  it("rejects malformed and oversized payloads", async () => {
    const bad = await errorReportPOST(
      new Request("http://localhost/api/error-report", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(bad.status).toBe(400);
    const oversized = await errorReportPOST(
      new Request("http://localhost/api/error-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x".repeat(600) }),
      }),
    );
    expect(oversized.status).toBe(400);
  });
});
