import { createAdminClient } from "@/lib/supabase/admin";
import { publicReportSnapshotSchema, type PublicReportSnapshot } from "@schemas/public-report";

import { checkRateLimit } from "./rate-limit";
import { hashShareToken, isWellFormedShareToken } from "./token";

/**
 * Public report resolution — the ONLY public read path.
 *
 * - Rate-limited per (token, IP) before any database work.
 * - Malformed tokens are rejected without a database lookup.
 * - Lookup is by token hash via the service role; the row's snapshot is
 *   the only payload ever returned. Workspace data is never selected.
 * - Unknown, revoked, and expired reports are indistinguishable
 *   ("not_found") so the endpoint cannot be used to probe which exist.
 * - View counting is best-effort and never blocks the read.
 */

export type PublicResolution =
  | { status: "ok"; snapshot: PublicReportSnapshot; noIndex: boolean }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterSeconds: number };

interface ReportRow {
  snapshot: unknown;
  no_index: boolean;
  expires_at: string | null;
  revoked_at: string | null;
}

export async function resolvePublicReport(
  token: string,
  clientIp: string,
  now: Date = new Date(),
): Promise<PublicResolution> {
  if (!isWellFormedShareToken(token)) return { status: "not_found" };

  const tokenHash = hashShareToken(token);
  const limit = checkRateLimit(`${tokenHash}:${clientIp}`, now.getTime());
  if (!limit.allowed) {
    return { status: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("public_reports")
    .select("id,snapshot,no_index,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) return { status: "not_found" };

  const row = data as ReportRow & { id: string };
  if (row.revoked_at !== null) return { status: "not_found" };
  if (row.expires_at !== null && Date.parse(row.expires_at) <= now.getTime()) {
    return { status: "not_found" };
  }

  const parsed = publicReportSnapshotSchema.safeParse(row.snapshot);
  if (!parsed.success) return { status: "not_found" };

  // Best-effort view counting — a failure here must not break the read.
  try {
    const { data: current } = await admin
      .from("public_reports")
      .select("view_count")
      .eq("id", row.id)
      .maybeSingle();
    const count = (current as { view_count: number } | null)?.view_count ?? 0;
    await admin
      .from("public_reports")
      .update({ view_count: count + 1, last_viewed_at: now.toISOString() })
      .eq("id", row.id);
  } catch {
    // Intentionally ignored: analytics must never break public reads.
  }

  return { status: "ok", snapshot: parsed.data, noIndex: row.no_index };
}
