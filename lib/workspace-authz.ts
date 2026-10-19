import {
  assertWorkspaceMembership,
  WorkspaceAccessDeniedError,
  type MembershipQueryClient,
} from "@/lib/supabase/workspace-auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared helper for server actions. Returns an authenticated Supabase client
 * plus the caller's user id, after proving workspace membership.
 *
 * Throws WorkspaceAccessDeniedError for unknown workspaces, non-members,
 * malformed ids, and signed-out callers — all indistinguishable by design.
 * Callers must still scope every query to workspace_id (defense in depth;
 * RLS is the final backstop).
 */
export async function requireWorkspaceClient(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new WorkspaceAccessDeniedError(workspaceId, "not signed in");
  }
  // The supabase-js client type is too deep for the structural
  // MembershipQueryClient interface; the runtime shape matches.
  await assertWorkspaceMembership(
    supabase as unknown as MembershipQueryClient,
    workspaceId,
    user.id,
  );
  return { supabase, userId: user.id };
}
