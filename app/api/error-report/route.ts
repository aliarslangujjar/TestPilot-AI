import { NextResponse } from "next/server";
import { z } from "zod";

import { reportError } from "@/lib/observability/report";
import { checkRateLimit } from "@/lib/public-reports/rate-limit";

/**
 * Client error beacon: browser error boundaries POST a capped,
 * sanitized summary here; the server records it through the same
 * structured reporter as server errors and returns its report id.
 * Unauthenticated by necessity (errors happen on public pages too) —
 * the payload is strictly capped and only logged, never stored or
 * rendered. A best-effort per-IP rate limit (shared limiter; per
 * instance, like the public-report limiter) bounds log flooding.
 */

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  message: z.string().min(1).max(500),
  route: z.string().max(200).optional(),
  digest: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = checkRateLimit(`error-report:${clientIp}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const reportId = reportError(new Error(parsed.data.message), {
    route: parsed.data.route,
    digest: parsed.data.digest,
    action: "client",
  });
  return NextResponse.json({ ok: true, reportId });
}
