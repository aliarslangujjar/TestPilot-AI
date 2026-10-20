import { createAdminClient } from "@/lib/supabase/admin";
import type { UsageAmounts } from "@schemas/usage";

import { currentPeriodStart, EMPTY_USAGE, getUsageLimits } from "./limits";

/**
 * Usage metering service (server-only).
 *
 * All counter writes go through the reserve/release/meter RPCs, which
 * serialize on the counter row lock — enforcement holds under
 * concurrency. Callers MUST have proven workspace membership first
 * (requireWorkspaceClient); these helpers trust that check.
 *
 * Failure policy: an explicit quota denial (RPC returns false) is
 * authoritative. Infrastructure failures (RPC unreachable) FAIL OPEN
 * for reservations — a metering outage must not take down the product —
 * and are swallowed for release/meter calls. This trade-off is
 * documented in docs/COST_MODEL.md.
 */

interface CounterRow {
  period_start: string;
  ai_calls: number;
  browser_runs: number;
  execution_seconds: number;
  storage_bytes: number;
}

function toAmounts(row: CounterRow): UsageAmounts {
  return {
    aiCalls: Number(row.ai_calls),
    browserRuns: Number(row.browser_runs),
    executionSeconds: Number(row.execution_seconds),
    storageBytes: Number(row.storage_bytes),
  };
}

function rpcArgs(workspaceId: string, amounts: Partial<UsageAmounts>) {
  return {
    p_workspace_id: workspaceId,
    p_period_start: currentPeriodStart(),
    p_ai_calls: amounts.aiCalls ?? 0,
    p_browser_runs: amounts.browserRuns ?? 0,
    p_execution_seconds: amounts.executionSeconds ?? 0,
    p_storage_bytes: amounts.storageBytes ?? 0,
  };
}

/**
 * Atomically reserve usage against the free-plan limits.
 * Returns true when reserved (or metering is unreachable — fail open),
 * false only on an explicit quota denial.
 */
export async function reserveUsage(
  workspaceId: string,
  amounts: Partial<UsageAmounts>,
): Promise<boolean> {
  const limits = getUsageLimits();
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("reserve_usage", {
      ...rpcArgs(workspaceId, amounts),
      p_ai_limit: limits.aiCalls,
      p_browser_runs_limit: limits.browserRuns,
      p_execution_seconds_limit: limits.executionSeconds,
      p_storage_limit: limits.storageBytes,
    });
    if (error) return true; // fail open on infrastructure errors
    return data === true;
  } catch {
    return true;
  }
}

/** Give a reservation back (e.g. the reserved work then failed). */
export async function releaseUsage(
  workspaceId: string,
  amounts: Partial<UsageAmounts>,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.rpc("release_usage", rpcArgs(workspaceId, amounts));
  } catch {
    // Best effort — counters also reset next period.
  }
}

/** Record already-consumed usage without a limit check (e.g. duration). */
export async function meterUsage(
  workspaceId: string,
  amounts: Partial<UsageAmounts>,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.rpc("meter_usage", rpcArgs(workspaceId, amounts));
  } catch {
    // Best effort.
  }
}

export async function getUsageCounters(
  workspaceId: string,
  periodStart: string = currentPeriodStart(),
): Promise<UsageAmounts> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("usage_counters")
    .select("period_start,ai_calls,browser_runs,execution_seconds,storage_bytes")
    .eq("workspace_id", workspaceId)
    .eq("period_start", periodStart)
    .maybeSingle();
  return data ? toAmounts(data as CounterRow) : { ...EMPTY_USAGE };
}

export async function getUsageHistory(
  workspaceId: string,
  limit = 6,
): Promise<Array<{ periodStart: string; usage: UsageAmounts }>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("usage_counters")
    .select("period_start,ai_calls,browser_runs,execution_seconds,storage_bytes")
    .eq("workspace_id", workspaceId)
    .order("period_start", { ascending: false })
    .limit(limit);
  return ((data ?? []) as CounterRow[]).map((row) => ({
    periodStart: row.period_start,
    usage: toAmounts(row),
  }));
}

/**
 * Reconcile storage usage from the private artifact bucket.
 *
 * Storage can't be incremented reliably at upload time (the worker
 * writes objects directly), so usage is reconciled by listing the
 * workspace's prefix and summing object sizes. Bounded (≤200 job
 * folders × ≤100 files) and best-effort: on any failure the last known
 * value stands. See docs/COST_MODEL.md.
 */
export async function syncStorageUsage(workspaceId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const bucket = admin.storage.from("browser-artifacts");
    const { data: folders, error } = await bucket.list(workspaceId, { limit: 200 });
    if (error || !folders) return;

    let total = 0;
    for (const folder of folders.slice(0, 200)) {
      if (folder.id !== null) {
        // A file directly under the workspace prefix.
        total += (folder.metadata?.size as number | undefined) ?? 0;
        continue;
      }
      const { data: files } = await bucket.list(`${workspaceId}/${folder.name}`, { limit: 100 });
      for (const file of files ?? []) {
        total += (file.metadata?.size as number | undefined) ?? 0;
      }
    }

    await admin.rpc("set_storage_usage", {
      p_workspace_id: workspaceId,
      p_period_start: currentPeriodStart(),
      p_storage_bytes: total,
    });
  } catch {
    // Best effort — reconciliation retries on the next usage view.
  }
}
