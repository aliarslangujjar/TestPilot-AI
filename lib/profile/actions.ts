"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { updateProfileSchema, type Profile, type UpdateProfileInput } from "@schemas/profile";

/**
 * Own-profile read/update. A user can only ever touch their own row —
 * enforced by RLS ("Users can view/update their own profile") and by
 * scoping every query to the signed-in user's id.
 */

const SIGNED_OUT = "You must be signed in.";
const NOT_FOUND = "Profile not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const PROFILE_COLUMNS = "id,email,display_name,avatar_url,created_at";

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

export async function getProfile(): Promise<ActionResult<Profile>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  if (error) return { ok: false, error: UNEXPECTED };
  if (!data) return { ok: false, error: NOT_FOUND };
  return { ok: true, data: toProfile(data as ProfileRow) };
}

export async function updateProfile(input: UpdateProfileInput): Promise<ActionResult<Profile>> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: SIGNED_OUT };

  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName?.trim() || null,
      avatar_url: parsed.data.avatarUrl?.trim() || null,
    })
    .eq("id", user.id)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) return { ok: false, error: UNEXPECTED };
  return { ok: true, data: toProfile(data as ProfileRow) };
}
