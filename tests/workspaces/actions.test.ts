/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspace } from "@/lib/workspaces/actions";

const USER_ID = "22222222-2222-2222-2222-222222222222";

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

const WS_ROW = { id: "generated-id", name: "Acme QA", created_at: "2026-10-18T10:00:00.000Z" };

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
    const calls: Array<{ table: string; q: ReturnType<typeof mockQuery> }> = [];
    fromMock.mockImplementation((table: string) => {
      const q =
        table === "workspaces"
          ? mockQuery({ data: WS_ROW, error: null })
          : mockQuery({ data: null, error: null });
      calls.push({ table, q });
      return q;
    });

    const result = await createWorkspace({ name: "Acme QA" });
    expect(result.ok).toBe(true);

    // Workspace insert carries a client-generated id (the SELECT policy
    // would block an insert-time returning row before membership exists).
    const wsInsert = calls[0]!;
    expect(wsInsert.table).toBe("workspaces");
    const insertArg = (wsInsert.q.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      id: string;
      name: string;
    };
    expect(insertArg.name).toBe("Acme QA");
    expect(typeof insertArg.id).toBe("string");
    expect(insertArg.id.length).toBeGreaterThan(0);

    const memberInsert = calls[1]!;
    expect(memberInsert.table).toBe("memberships");
    expect((memberInsert.q.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      workspace_id: insertArg.id,
      user_id: USER_ID,
      role: "owner",
    });

    expect(result).toEqual({
      ok: true,
      data: { id: WS_ROW.id, name: "Acme QA", createdAt: WS_ROW.created_at },
    });
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("cleans up the workspace when the membership bootstrap fails", async () => {
    const calls: Array<{ table: string; q: ReturnType<typeof mockQuery> }> = [];
    fromMock.mockImplementation((table: string) => {
      const q =
        table === "workspaces"
          ? mockQuery({ data: WS_ROW, error: null })
          : mockQuery({ data: null, error: { message: "denied" } });
      calls.push({ table, q });
      return q;
    });

    const result = await createWorkspace({ name: "Acme QA" });
    expect(result.ok).toBe(false);

    const insertArg = (calls[0]!.q.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      id: string;
    };
    // Best-effort delete of the ownerless workspace.
    const cleanup = calls[2]!;
    expect(cleanup.table).toBe("workspaces");
    expect(cleanup.q.delete).toHaveBeenCalled();
    expect((cleanup.q.eq as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      "id",
      insertArg.id,
    ]);
  });
});
