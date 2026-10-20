import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges the one-time `code` from Supabase email links (password reset,
 * email confirmation) for a session, then redirects to `next`.
 *
 * The `next` parameter is strictly validated to a same-origin path to
 * prevent open-redirect attacks: only values starting with a single "/"
 * are honored; everything else falls back to /dashboard/projects.
 * Backslashes are rejected explicitly: the WHATWG URL parser treats
 * "\" as "/" for special schemes, so "/\evil.com" would otherwise
 * normalize into a protocol-relative URL pointing off-origin. The
 * redirect site additionally asserts the resolved origin matches.
 */
function getSafeNextPath(next: string | null): string {
  // eslint-disable-next-line no-control-regex -- rejecting control chars in `next` is the point
  const hasControlChars = next ? /[\s\u0000-\u001f\u007f]/.test(next) : false;
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !hasControlChars
  ) {
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
      const target = new URL(next, request.url);
      // Belt and braces: the resolved redirect must stay on this origin.
      if (target.origin !== new URL(request.url).origin) {
        return NextResponse.redirect(new URL("/dashboard/projects", request.url));
      }
      return NextResponse.redirect(target);
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "link-expired");
  return NextResponse.redirect(loginUrl);
}
