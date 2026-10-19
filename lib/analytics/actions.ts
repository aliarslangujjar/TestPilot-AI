"use server";

import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import type { ActionResult } from "@/lib/action-result";
import {
  analyticsRangeSchema,
  type AnalyticsRange,
  type AnalyticsTotals,
  type DailyPoint,
} from "@schemas/analytics";

/**
 * Workspace analytics, computed from real execution data.
 *
 * Every number comes from run_results / test_runs / test_cases — there is no
 * sample data anywhere here. Per-day series are built from executed_at
 * timestamps; days with no executions carry zero counts and a null pass
 * rate (never a fabricated 0%).
 */

const NO_ACCESS = "You don't have access to this workspace.";
const UNEXPECTED = "Something went wrong. Please try again.";

export interface AnalyticsData {
  totals: AnalyticsTotals;
  daily: DailyPoint[];
  range: AnalyticsRange;
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function getAnalytics(
  workspaceId: string,
  range: number,
): Promise<ActionResult<AnalyticsData>> {
  try {
    const parsed = analyticsRangeSchema.safeParse(range);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid range." };
    }
    const days = parsed.data as AnalyticsRange;
    const { supabase } = await requireWorkspaceClient(workspaceId);

    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));

    const [projects, suites, cases, drafts, runs, results] = await Promise.all([
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false),
      supabase
        .from("suites")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false),
      supabase
        .from("test_cases")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false),
      supabase
        .from("test_cases")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false)
        .eq("status", "draft"),
      supabase
        .from("test_runs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      supabase
        .from("run_results")
        .select("outcome,executed_at")
        .eq("workspace_id", workspaceId)
        .neq("outcome", "unexecuted")
        .not("executed_at", "is", null)
        .gte("executed_at", cutoff.toISOString()),
    ]);

    for (const r of [projects, suites, cases, drafts, runs, results]) {
      if (r.error) return { ok: false, error: toError(r.error) };
    }

    // Per-day buckets for the whole range, oldest first.
    const buckets = new Map<
      string,
      { pass: number; fail: number; blocked: number; skipped: number }
    >();
    const daily: DailyPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(cutoff);
      d.setUTCDate(d.getUTCDate() + i);
      const key = dayKey(d);
      buckets.set(key, { pass: 0, fail: 0, blocked: 0, skipped: 0 });
      daily.push({
        date: key,
        label: dayLabel(d),
        pass: 0,
        fail: 0,
        blocked: 0,
        skipped: 0,
        total: 0,
        passRate: null,
      });
    }

    let pass = 0;
    let fail = 0;
    let blocked = 0;
    let skipped = 0;
    for (const row of (results.data ?? []) as Array<{ outcome: string; executed_at: string }>) {
      const bucket = buckets.get(dayKey(new Date(row.executed_at)));
      if (!bucket) continue;
      if (row.outcome === "pass") {
        bucket.pass += 1;
        pass += 1;
      } else if (row.outcome === "fail") {
        bucket.fail += 1;
        fail += 1;
      } else if (row.outcome === "blocked") {
        bucket.blocked += 1;
        blocked += 1;
      } else if (row.outcome === "skipped") {
        bucket.skipped += 1;
        skipped += 1;
      }
    }

    for (const point of daily) {
      const bucket = buckets.get(point.date)!;
      point.pass = bucket.pass;
      point.fail = bucket.fail;
      point.blocked = bucket.blocked;
      point.skipped = bucket.skipped;
      point.total = bucket.pass + bucket.fail + bucket.blocked + bucket.skipped;
      point.passRate = point.total > 0 ? Math.round((bucket.pass / point.total) * 100) : null;
    }

    const executions = pass + fail + blocked + skipped;

    return {
      ok: true,
      data: {
        range: days,
        totals: {
          projects: projects.count ?? 0,
          suites: suites.count ?? 0,
          testCases: cases.count ?? 0,
          draftCases: drafts.count ?? 0,
          runs: runs.count ?? 0,
          executions,
          pass,
          fail,
          blocked,
          skipped,
          passRate: executions > 0 ? Math.round((pass / executions) * 100) : null,
        },
        daily,
      },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
