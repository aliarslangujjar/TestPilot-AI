/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import proxy from "@/proxy";

const { getUserMock, createServerClientMock, envMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  createServerClientMock: vi.fn(),
  envMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));
vi.mock("@/lib/supabase/env", () => ({
  getPublicSupabaseEnv: () => envMock(),
}));

function requestTo(path: string) {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

const GOOD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
};

beforeEach(() => {
  vi.clearAllMocks();
  createServerClientMock.mockReturnValue({ auth: { getUser: getUserMock } });
  envMock.mockReturnValue(GOOD_ENV);
  getUserMock.mockResolvedValue({ data: { user: null } });
});

describe("proxy graceful degradation", () => {
  it("serves public pages and gates protected ones when Supabase env is missing", async () => {
    envMock.mockImplementation(() => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    });
    const pub = await proxy(requestTo("/"));
    expect(pub.status).toBe(200);
    const prot = await proxy(requestTo("/dashboard/projects"));
    expect(prot.status).toBe(307);
    expect(prot.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("treats an unreachable auth service as signed out instead of crashing", async () => {
    getUserMock.mockRejectedValue(new Error("fetch failed"));
    const prot = await proxy(requestTo("/dashboard"));
    expect(prot.status).toBe(307);
    expect(prot.headers.get("location")).toBe("http://localhost:3000/login");
    const pub = await proxy(requestTo("/login"));
    expect(pub.status).toBe(200);
  });
});
