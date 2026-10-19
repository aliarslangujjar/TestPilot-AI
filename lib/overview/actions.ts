"use server";

import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import type { ActionResult } from "@/lib/action-result";

/**
 * Workspace overview statistics for the dashboard. Read-only aggregates —
 * counts and the most recently updated test cases. Every query is scoped
 * to the workspace after proving membership.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const UNEXPECTED = "Something went wrong. Please try again.";

export interface RecentCase {
  id: string;
  title: string;
  status: string;
  priority: string;
  updatedAt: string;
  suiteName: string;
}

export interface OverviewStats {
  projects: number;
  suites: number;
  testCases: number;
  draftCases: number;
  activeCases: number;
  recentCases: RecentCase[];
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

export async function getOverviewStats(workspaceId: string): Promise<ActionResult<OverviewStats>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);

    const [projects, suites, cases, drafts, actives, recent] = await Promise.all([
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
        .from("test_cases")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false)
        .eq("status", "active"),
      supabase
        .from("test_cases")
        .select("id,title,status,priority,updated_at,suites!inner(name)")
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false)
        .order("updated_at", { ascending: false })
        .limit(5),
    ]);

    for (const r of [projects, suites, cases, drafts, actives, recent]) {
      if (r.error) return { ok: false, error: toError(r.error) };
    }

    const recentCases = (
      (recent.data ?? []) as Array<{
        id: string;
        title: string;
        status: string;
        priority: string;
        updated_at: string;
        suites: { name: string } | Array<{ name: string }>;
      }>
    ).map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      priority: c.priority,
      updatedAt: c.updated_at,
      suiteName: Array.isArray(c.suites) ? (c.suites[0]?.name ?? "—") : c.suites.name,
    }));

    return {
      ok: true,
      data: {
        projects: projects.count ?? 0,
        suites: suites.count ?? 0,
        testCases: cases.count ?? 0,
        draftCases: drafts.count ?? 0,
        activeCases: actives.count ?? 0,
        recentCases,
      },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
