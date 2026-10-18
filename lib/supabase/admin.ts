import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv } from "./env";

/**
 * Service-role Supabase client — SERVER ONLY.
 *
 * Bypasses Row Level Security. Every code path using this client MUST
 * enforce authorization explicitly (see ./workspace-auth.ts) before
 * touching workspace-scoped data.
 *
 * Never import this module from browser code. The guard below fails fast
 * if it ever happens.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient must never be called in the browser: the service-role key would be exposed.",
    );
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (never commit it).",
    );
  }
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  return createSupabaseClient(NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
