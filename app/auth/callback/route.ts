import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges the one-time `code` from Supabase email links (password reset,
 * email confirmation) for a session, then redirects to `next`.
 *
 * The `next` parameter is strictly validated to a same-origin path to
 * prevent open-redirect attacks: only values starting with a single "/"
 * are honored; everything else falls back to /dashboard/projects.
 */
function getSafeNextPath(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/dashboard/projects";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "link-expired");
  return NextResponse.redirect(loginUrl);
}
