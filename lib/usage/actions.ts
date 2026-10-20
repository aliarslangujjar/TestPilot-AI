"use server";

import type { ActionResult } from "@/lib/action-result";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { usageSnapshotSchema, type UsageSnapshot } from "@schemas/usage";

import { currentPeriodStart, getUsageLimits, periodEndFor } from "./limits";
import { getUsageCounters, getUsageHistory, syncStorageUsage } from "./usage";

/**
 * Usage snapshot for the usage page: current-period counters against
 * the free-plan limits, plus recent period history. Viewing the page
 * first reconciles artifact storage from the bucket (best effort).
 */
export async function getWorkspaceUsage(workspaceId: string): Promise<ActionResult<UsageSnapshot>> {
  try {
    await requireWorkspaceClient(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { ok: false, error: "You don't have access to this workspace." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  try {
    await syncStorageUsage(workspaceId);
    const periodStart = currentPeriodStart();
    const [usage, history] = await Promise.all([
      getUsageCounters(workspaceId, periodStart),
      getUsageHistory(workspaceId, 6),
    ]);
    return {
      ok: true,
      data: usageSnapshotSchema.parse({
        periodStart,
        periodEnd: periodEndFor(periodStart),
        limits: getUsageLimits(),
        usage,
        history: history.filter((h) => h.periodStart !== periodStart),
      }),
    };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
