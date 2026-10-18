/**
 * Server-side workspace authorization for service-role code paths.
 *
 * The service-role client bypasses Row Level Security, so any server code
 * using it must prove the user belongs to the workspace BEFORE reading or
 * writing workspace-scoped data. RLS remains the primary enforcement for
 * anon-key clients; this module is defense-in-depth for admin-client paths.
 */

export type WorkspaceRole = "owner" | "admin" | "member";

export class WorkspaceAccessDeniedError extends Error {
  readonly workspaceId: string;
  constructor(workspaceId: string, reason: string) {
    super(`Access denied to workspace ${workspaceId}: ${reason}`);
    this.name = "WorkspaceAccessDeniedError";
    this.workspaceId = workspaceId;
  }
}

/** Minimal shape of the membership row we read. */
interface MembershipRow {
  role: WorkspaceRole;
}

/** Minimal query-builder surface we need (compatible with supabase-js). */
export interface MembershipQueryClient {
  from(table: "memberships"): {
    select(columns: string): {
      eq(
        column: "workspace_id",
        value: string,
      ): {
        eq(
          column: "user_id",
          value: string,
        ): {
          maybeSingle(): Promise<{ data: MembershipRow | null; error: unknown }>;
        };
      };
    };
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asserts that `userId` is a member of `workspaceId`. Returns the member's
 * role. Throws WorkspaceAccessDeniedError otherwise (unknown workspace,
 * non-member, or malformed ids — all indistinguishable to the caller).
 */
export async function assertWorkspaceMembership(
  client: MembershipQueryClient,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole> {
  if (!uuidPattern.test(workspaceId) || !uuidPattern.test(userId)) {
    throw new WorkspaceAccessDeniedError(workspaceId, "invalid identifier");
  }
  const { data, error } = await client
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    throw new WorkspaceAccessDeniedError(workspaceId, "not a member");
  }
  return data.role;
}

/**
 * Asserts membership AND that the role is owner or admin.
 */
export async function assertWorkspaceAdmin(
  client: MembershipQueryClient,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole> {
  const role = await assertWorkspaceMembership(client, workspaceId, userId);
  if (role !== "owner" && role !== "admin") {
    throw new WorkspaceAccessDeniedError(workspaceId, "requires owner or admin");
  }
  return role;
}
