import { createClient } from "@/lib/supabase/server";

/**
 * Resolves the workspace the app operates in. Multi-workspace switching UI
 * doesn't exist yet, so this returns the earliest-joined workspace. Every
 * project action still takes the workspace id explicitly and re-asserts
 * membership — this helper is convenience, not authorization.
 */
export async function getCurrentWorkspace(): Promise<{
  id: string;
  name: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("memberships")
    .select("created_at, workspaces!inner(id, name)")
    .eq("user_id", user.id);
  if (error || !data || data.length === 0) return null;

  const rows = data as unknown as Array<{
    created_at: string;
    workspaces: { id: string; name: string };
  }>;
  rows.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const first = rows[0];
  if (!first) return null;
  return { id: first.workspaces.id, name: first.workspaces.name };
}
