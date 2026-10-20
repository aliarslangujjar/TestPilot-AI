import { NextResponse } from "next/server";

import { getAIStatus } from "@/lib/ai/service";

/**
 * Health check (see docs/DEPLOYMENT.md).
 *
 * Liveness + dependency status in one response. The route itself
 * answering means the app is up; dependency problems are reported as
 * "degraded" (HTTP 200) rather than failing the check, so an external
 * monitor can alert on the JSON body while the site keeps serving
 * what it can (the proxy degrades the same way). No secrets, versions
 * beyond the environment name, or internals are exposed.
 */

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "not_configured" | "unreachable" | "disabled" | "demo";

async function checkDatabase(): Promise<CheckStatus> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return "not_configured";
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
      // A health probe must not follow redirects: the configured URL is
      // operator-controlled, but a redirect would silently retarget the
      // probe (and its apikey header) to another host.
      redirect: "manual",
    });
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkAI(): Promise<CheckStatus> {
  try {
    const status = await getAIStatus();
    if (status.demo) return "demo";
    return status.enabled ? "ok" : "disabled";
  } catch {
    return "disabled";
  }
}

export async function GET() {
  const [database, ai] = await Promise.all([checkDatabase(), checkAI()]);
  const degraded = database !== "ok";
  return NextResponse.json(
    {
      status: degraded ? "degraded" : "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV ?? "local",
      checks: { database, ai },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
