/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import proxy from "@/proxy";

const { getUserMock, createServerClientMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  createServerClientMock: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));
vi.mock("@/lib/supabase/env", () => ({
  getPublicSupabaseEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  createServerClientMock.mockReturnValue({ auth: { getUser: getUserMock } });
});

function requestTo(path: string) {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

function asSignedIn() {
  getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
}

function asSignedOut() {
  getUserMock.mockResolvedValue({ data: { user: null } });
}

describe("proxy route protection", () => {
  it("redirects signed-out users from /dashboard to /login", async () => {
    asSignedOut();
    const res = await proxy(requestTo("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("redirects signed-out users from /reset-password to /login", async () => {
    asSignedOut();
    const res = await proxy(requestTo("/reset-password"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets signed-in users reach /dashboard", async () => {
    asSignedIn();
    const res = await proxy(requestTo("/dashboard"));
    expect(res.status).toBe(200);
  });

  it("redirects signed-in users away from /login to /dashboard/projects", async () => {
    asSignedIn();
    const res = await proxy(requestTo("/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/projects");
  });

  it("lets signed-out users reach public pages", async () => {
    asSignedOut();
    for (const path of ["/", "/login", "/forgot-password"]) {
      const res = await proxy(requestTo(path));
      expect(res.status, path).toBe(200);
    }
  });
});
