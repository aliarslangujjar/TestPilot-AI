"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import {
  createWorkspaceSchema,
  type CreateWorkspaceInput,
  type Workspace,
} from "@schemas/workspace";

/**
 * Workspace creation. Any signed-in user may create a workspace; the creator
 * is bootstrapped as its owner (per the memberships RLS bootstrap policy).
 * RLS is the backstop: the workspace insert policy allows authenticated
 * inserts, and the membership bootstrap policy only allows self-insert as
 * owner when the workspace has zero members.
 *
 * The id is generated client-side because the workspaces SELECT policy
 * ("Members can view their workspaces") would block the insert's returning
 * row before the membership exists — chaining .select().single() on the
 * insert fails with 0 rows. We select the row only after bootstrapping
 * the owner membership.
 */

const SIGNED_OUT = "You must be signed in.";
const UNEXPECTED = "Something went wrong. Please try again.";

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<ActionResult<Workspace>> {
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };

  const workspaceId = crypto.randomUUID();

  const { error: workspaceError } = await supabase
    .from("workspaces")
    .insert({ id: workspaceId, name: parsed.data.name });

  if (workspaceError) return { ok: false, error: UNEXPECTED };

  const { error: membershipError } = await supabase.from("memberships").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "owner",
  });

  if (membershipError) {
    // Best-effort cleanup: don't leave an ownerless workspace behind.
    await supabase.from("workspaces").delete().eq("id", workspaceId);
    return { ok: false, error: UNEXPECTED };
  }

  const { data: workspace, error: fetchError } = await supabase
    .from("workspaces")
    .select("id,name,created_at")
    .eq("id", workspaceId)
    .single();

  if (fetchError || !workspace) return { ok: false, error: UNEXPECTED };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");

  const row = workspace as WorkspaceRow;
  return {
    ok: true,
    data: { id: row.id, name: row.name, createdAt: row.created_at },
  };
}
