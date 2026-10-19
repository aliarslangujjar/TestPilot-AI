/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProfile, updateProfile } from "@/lib/profile/actions";

const USER_ID = "22222222-2222-2222-2222-222222222222";

const { fromMock, getUserMock, createClientMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

function mockQuery(result: { data?: unknown; error?: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "single", "maybeSingle"]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown) => void) =>
    resolve({ data: result.data ?? null, error: result.error ?? null });
  return q;
}

const ROW = {
  id: USER_ID,
  email: "ali@example.com",
  display_name: "Jane Doe",
  avatar_url: null,
  created_at: "2026-10-01T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
  fromMock.mockReturnValue(mockQuery({ data: ROW, error: null }));
});

describe("getProfile", () => {
  it("requires sign-in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const result = await getProfile();
    expect(result).toEqual({ ok: false, error: "You must be signed in." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the mapped own profile", async () => {
    const result = await getProfile();
    expect(result).toEqual({
      ok: true,
      data: {
        id: USER_ID,
        email: "ali@example.com",
        displayName: "Jane Doe",
        avatarUrl: null,
        createdAt: "2026-10-01T10:00:00.000Z",
      },
    });
    expect(fromMock).toHaveBeenCalledWith("profiles");
  });

  it("reports a missing profile", async () => {
    fromMock.mockReturnValue(mockQuery({ data: null, error: null }));
    const result = await getProfile();
    expect(result).toEqual({ ok: false, error: "Profile not found." });
  });
});

describe("updateProfile", () => {
  it("validates before touching the database", async () => {
    const bad = await updateProfile({
      displayName: "x".repeat(101),
      avatarUrl: "not-a-url",
    });
    expect(bad.ok).toBe(false);
    expect(createClientMock).not.toHaveBeenCalled();

    const longUrl = await updateProfile({
      displayName: null,
      avatarUrl: "ftp://example.com/x.png",
    });
    expect(longUrl.ok).toBe(false);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("updates only the signed-in user's row", async () => {
    const updated = { ...ROW, display_name: "Janet" };
    const q = mockQuery({ data: updated, error: null });
    fromMock.mockReturnValue(q);

    const result = await updateProfile({ displayName: "Janet", avatarUrl: null });
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ displayName: "Janet" }),
    });
    const updateCalls = (q.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls[0]?.[0]).toEqual({
      display_name: "Janet",
      avatar_url: null,
    });
    expect((q.eq as ReturnType<typeof vi.fn>).mock.calls).toContainEqual(["id", USER_ID]);
  });

  it("requires sign-in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const result = await updateProfile({ displayName: "Janet", avatarUrl: null });
    expect(result).toEqual({ ok: false, error: "You must be signed in." });
  });
});
