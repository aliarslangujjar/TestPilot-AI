import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseEnv, type PublicSupabaseEnv } from "@/lib/supabase/env";

/**
 * Request proxy (Next.js 16 convention): refreshes the Supabase session on
 * every request so server components always see a valid session, and
 * enforces route protection:
 * - /dashboard/* requires a signed-in user (otherwise -> /login)
 * - /login and /forgot-password redirect to /dashboard/projects when signed in
 *
 * Graceful degradation (see docs/DEPLOYMENT.md): when Supabase is not
 * configured in this environment, or its auth endpoint is unreachable,
 * the site must not go down with it — public pages keep serving and
 * protected routes bounce to /login.
 */
export default async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login" || pathname === "/forgot-password";
  // /reset-password is protected: it only works with the fresh session the
  // /auth/callback route establishes from the email link's code.
  const isProtected =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/reset-password";

  const redirectToLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  };

  let env: PublicSupabaseEnv;
  try {
    env = getPublicSupabaseEnv();
  } catch {
    // Supabase env not configured here (e.g. a fresh preview deployment
    // before secrets are set): serve public routes, gate protected ones.
    return isProtected ? redirectToLogin() : supabaseResponse;
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() validates the JWT; never trust getSession() alone here.
  // An unreachable auth service is treated as "no user" rather than an
  // outage for the whole site.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Auth unreachable: user stays null (treated as signed out).
  }

  if (!user && isProtected) {
    return redirectToLogin();
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard/projects";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
