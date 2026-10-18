/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceAccessDeniedError,
  assertWorkspaceAdmin,
  assertWorkspaceMembership,
  type MembershipQueryClient,
} from "@/lib/supabase/workspace-auth";

const WS = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const U1 = "11111111-1111-1111-1111-111111111111";

/** Builds a minimal mock of the supabase-js membership query chain. */
function mockClient(result: {
  data: { role: "owner" | "admin" | "member" } | null;
  error: unknown;
}) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eqUser = vi.fn().mockReturnValue({ maybeSingle });
  const eqWorkspace = vi.fn().mockReturnValue({ eq: eqUser });
  const select = vi.fn().mockReturnValue({ eq: eqWorkspace });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as MembershipQueryClient;
  return { client, from, maybeSingle };
}

describe("assertWorkspaceMembership", () => {
  it("returns the member role for a workspace member", async () => {
    const { client } = mockClient({ data: { role: "member" }, error: null });
    await expect(assertWorkspaceMembership(client, WS, U1)).resolves.toBe("member");
  });

  it("throws WorkspaceAccessDeniedError for a non-member", async () => {
    const { client } = mockClient({ data: null, error: null });
    await expect(assertWorkspaceMembership(client, WS, U1)).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
  });

  it("throws on query error without leaking details", async () => {
    const { client } = mockClient({ data: null, error: new Error("db down") });
    const err = await assertWorkspaceMembership(client, WS, U1).catch((e) => e);
    expect(err).toBeInstanceOf(WorkspaceAccessDeniedError);
    expect((err as Error).message).not.toContain("db down");
  });

  it("rejects malformed ids without querying", async () => {
    const { client, from } = mockClient({ data: { role: "owner" }, error: null });
    await expect(assertWorkspaceMembership(client, "not-a-uuid", U1)).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
    await expect(assertWorkspaceMembership(client, WS, "nope")).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
    expect(from).not.toHaveBeenCalled();
  });
});

describe("assertWorkspaceAdmin", () => {
  it("passes for owners and admins", async () => {
    const owner = mockClient({ data: { role: "owner" }, error: null });
    const admin = mockClient({ data: { role: "admin" }, error: null });
    await expect(assertWorkspaceAdmin(owner.client, WS, U1)).resolves.toBe("owner");
    await expect(assertWorkspaceAdmin(admin.client, WS, U1)).resolves.toBe("admin");
  });

  it("throws for plain members", async () => {
    const { client } = mockClient({ data: { role: "member" }, error: null });
    await expect(assertWorkspaceAdmin(client, WS, U1)).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
  });
});
