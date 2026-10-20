/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/auth/callback/route";

const { exchangeMock, createClientMock } = vi.hoisted(() => ({
  exchangeMock: vi.fn(),
  createClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  createClientMock.mockResolvedValue({ auth: { exchangeCodeForSession: exchangeMock } });
});

function callbackRequest(query: string) {
  return new NextRequest(new URL(`http://localhost:3000/auth/callback${query}`));
}

describe("GET /auth/callback", () => {
  it("exchanges a valid code and redirects to the requested path", async () => {
    exchangeMock.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest("?code=abc123&next=/reset-password"));
    expect(exchangeMock).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/reset-password");
  });

  it("falls back to /dashboard when next is missing", async () => {
    exchangeMock.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest("?code=abc123"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/projects");
  });

  it("rejects absolute URLs in next (open-redirect protection)", async () => {
    exchangeMock.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest("?code=abc123&next=https://evil.example"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/projects");
  });

  it("rejects protocol-relative URLs in next", async () => {
    exchangeMock.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest("?code=abc123&next=//evil.example/path"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/projects");
  });

  it("rejects backslash URLs in next (WHATWG parser treats \\ as / — audit addendum)", async () => {
    exchangeMock.mockResolvedValue({ error: null });
    const res = await GET(callbackRequest("?code=abc123&next=/\\evil.example/phish"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/projects");
    const res2 = await GET(callbackRequest("?code=abc123&next=%2F%5Cevil.example"));
    expect(res2.headers.get("location")).toBe("http://localhost:3000/dashboard/projects");
  });

  it("sends missing codes to /login with an error flag", async () => {
    const res = await GET(callbackRequest(""));
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=link-expired");
  });

  it("sends failed exchanges to /login with an error flag", async () => {
    exchangeMock.mockResolvedValue({ error: { message: "bad code" } });
    const res = await GET(callbackRequest("?code=stale&next=/reset-password"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=link-expired");
  });
});
