/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspace } from "@/lib/workspaces/actions";

const USER_ID = "22222222-2222-2222-2222-222222222222";
const WS_ID = "11111111-1111-1111-1111-111111111111";

const { fromMock, getUserMock, createClientMock, revalidateMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  createClientMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidateMock(...args),
}));

function mockQuery(result: { data?: unknown; error?: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["insert", "select", "single", "delete", "eq"]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (value: unknown) => void) =>
    resolve({ data: result.data ?? null, error: result.error ?? null });
  return q;
}

const WS_ROW = { id: WS_ID, name: "Acme QA", created_at: "2026-10-18T10:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: getUserMock }, from: fromMock });
});

describe("createWorkspace", () => {
  it("validates before touching the database", async () => {
    const result = await createWorkspace({ name: "x" });
    expect(result.ok).toBe(false);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const result = await createWorkspace({ name: "Acme QA" });
    expect(result).toEqual({ ok: false, error: "You must be signed in." });
  });

  it("creates the workspace and bootstraps the creator as owner", async () => {
    const queries: ReturnType<typeof mockQuery>[] = [];
    fromMock.mockImplementation((table: string) => {
      const q =
        table === "workspaces"
          ? mockQuery({ data: WS_ROW, error: null })
          : mockQuery({ data: null, error: null });
      queries.push(q);
      return q;
    });

    const result = await createWorkspace({ name: "Acme QA" });
    expect(result).toEqual({
      ok: true,
      data: { id: WS_ID, name: "Acme QA", createdAt: WS_ROW.created_at },
    });

    const wsQuery = queries[0]!;
    expect((wsQuery.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      name: "Acme QA",
    });
    const memberQuery = queries[1]!;
    expect((memberQuery.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      workspace_id: WS_ID,
      user_id: USER_ID,
      role: "owner",
    });
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("cleans up the workspace when the membership bootstrap fails", async () => {
    const queries: ReturnType<typeof mockQuery>[] = [];
    fromMock.mockImplementation((table: string) => {
      const q =
        table === "workspaces"
          ? mockQuery({ data: WS_ROW, error: null })
          : mockQuery({ data: null, error: { message: "denied" } });
      queries.push(q);
      return q;
    });

    const result = await createWorkspace({ name: "Acme QA" });
    expect(result.ok).toBe(false);

    // Best-effort delete of the ownerless workspace.
    const deleteQuery = queries[2]!;
    expect(deleteQuery.delete).toHaveBeenCalled();
    expect((deleteQuery.eq as ReturnType<typeof vi.fn>).mock.calls).toContainEqual(["id", WS_ID]);
  });
});
