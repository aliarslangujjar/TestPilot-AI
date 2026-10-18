import { z } from "zod";

/**
 * Validated access to Supabase environment variables.
 *
 * Only public (NEXT_PUBLIC_*) variables live here, so this module is safe
 * to import from browser code. The service-role key is deliberately NOT
 * here — see lib/supabase/admin.ts (server-only).
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is not set")
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set"),
});

export type PublicSupabaseEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicSupabaseEnv | null = null;

/**
 * Returns the validated public Supabase env. Throws a descriptive error
 * when a variable is missing or malformed instead of failing later with
 * an opaque client error.
 */
export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  if (!cached) {
    cached = publicEnvSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return cached;
}
