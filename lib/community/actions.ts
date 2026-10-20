"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { createSuiteSchema } from "@schemas/suite";
import {
  communityTemplateDetailSchema,
  communityTemplateSchema,
  templateAppTypeSchema,
  templateLicenseSchema,
  templateReportReasonSchema,
  type CommunityTemplate,
  type CommunityTemplateDetail,
} from "@schemas/community";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";

import { validateTemplateContent } from "./validate";

/**
 * Community template library actions.
 *
 * Publishing snapshots a stored test plan's cases into a cross-workspace
 * template (validated + content-scanned). Browsing reads published rows
 * only. Importing RE-VALIDATES the stored content (untrusted data) and
 * creates draft cases in the importer's own project — imports never
 * touch the author's workspace and never modify the template.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const PLAN_NOT_FOUND = "Test plan not found.";
const TEMPLATE_NOT_FOUND = "Template not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const TEMPLATE_COLUMNS =
  "id,name,description,app_type,license,tags,author_user_id,author_display_name,case_count,view_count,import_count,status,created_at,updated_at";

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  app_type: CommunityTemplate["appType"];
  license: CommunityTemplate["license"];
  tags: string[];
  author_user_id: string;
  author_display_name: string;
  case_count: number;
  view_count: number;
  import_count: number;
  status: CommunityTemplate["status"];
  created_at: string;
  updated_at: string;
  content?: unknown;
}

function toTemplate(row: TemplateRow): CommunityTemplate {
  return communityTemplateSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    appType: row.app_type,
    license: row.license,
    tags: row.tags,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    caseCount: row.case_count,
    viewCount: row.view_count,
    importCount: row.import_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const publishInputSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).default(""),
  license: templateLicenseSchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
});

export async function publishCommunityTemplate(
  workspaceId: string,
  projectId: string,
  planId: string,
  input: unknown,
): Promise<ActionResult<CommunityTemplate>> {
  const parsed = publishInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);

    const { data: planRow } = await supabase
      .from("test_plans")
      .select("id,name,template_key,plan")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", planId)
      .maybeSingle();
    if (!planRow) return { ok: false, error: PLAN_NOT_FOUND };
    const plan = planRow as { name: string; template_key: string; plan: { cases: unknown[] } };

    // Re-validate + scan the cases before they become public data.
    const validation = validateTemplateContent({ cases: plan.plan.cases });
    if (!validation.ok) return { ok: false, error: validation.error };

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    const authorDisplayName =
      (profile as { display_name: string | null } | null)?.display_name?.trim() || "Anonymous";

    const appType = templateAppTypeSchema.safeParse(plan.template_key).success
      ? (plan.template_key as CommunityTemplate["appType"])
      : "custom";

    const { data: row, error } = await supabase
      .from("community_templates")
      .insert({
        author_user_id: userId,
        author_display_name: authorDisplayName.slice(0, 120),
        name: (parsed.data.name ?? plan.name).slice(0, 120),
        description: parsed.data.description,
        app_type: appType,
        license: parsed.data.license,
        tags: parsed.data.tags,
        content: validation.content,
        case_count: validation.content.cases.length,
        status: "published",
      })
      .select(TEMPLATE_COLUMNS)
      .single();
    if (error || !row) return { ok: false, error: UNEXPECTED };

    revalidatePath("/dashboard/community");
    return { ok: true, data: toTemplate(row as TemplateRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------------------------------------------------------------------------
// Browse / preview
// ---------------------------------------------------------------------------

const browseFiltersSchema = z.object({
  search: z.string().trim().max(100).default(""),
  appType: templateAppTypeSchema.nullable().default(null),
  license: templateLicenseSchema.nullable().default(null),
  tag: z.string().trim().max(30).default(""),
  sort: z.enum(["newest", "most_imported", "most_viewed"]).default("newest"),
});

export type BrowseFilters = z.input<typeof browseFiltersSchema>;

export async function listCommunityTemplates(
  workspaceId: string,
  filters?: BrowseFilters,
): Promise<ActionResult<CommunityTemplate[]>> {
  const parsed = browseFiltersSchema.safeParse(filters ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  const f = parsed.data;

  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    let query = supabase
      .from("community_templates")
      .select(TEMPLATE_COLUMNS)
      .eq("status", "published");
    if (f.search) {
      const safe = f.search.replace(/[%_,()]/g, " ").trim();
      if (safe) query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
    }
    if (f.appType) query = query.eq("app_type", f.appType);
    if (f.license) query = query.eq("license", f.license);
    if (f.tag) query = query.contains("tags", [f.tag]);
    query =
      f.sort === "most_imported"
        ? query.order("import_count", { ascending: false })
        : f.sort === "most_viewed"
          ? query.order("view_count", { ascending: false })
          : query.order("created_at", { ascending: false });

    const { data, error } = await query.limit(100);
    if (error) return { ok: false, error: UNEXPECTED };
    return { ok: true, data: ((data ?? []) as TemplateRow[]).map(toTemplate) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function getCommunityTemplate(
  workspaceId: string,
  templateId: string,
): Promise<ActionResult<CommunityTemplateDetail>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data } = await supabase
      .from("community_templates")
      .select(`${TEMPLATE_COLUMNS},content`)
      .eq("id", templateId)
      .maybeSingle();
    if (!data) return { ok: false, error: TEMPLATE_NOT_FOUND };
    const row = data as TemplateRow;
    if (row.status !== "published") return { ok: false, error: TEMPLATE_NOT_FOUND };

    // Stored content is untrusted: validate before previewing it.
    const validation = validateTemplateContent(row.content);
    if (!validation.ok) return { ok: false, error: TEMPLATE_NOT_FOUND };

    // Best-effort view counting via the narrow counter RPC.
    try {
      await supabase.rpc("bump_community_template_views", { p_template_id: templateId });
    } catch {
      // Counting must never break browsing.
    }

    return {
      ok: true,
      data: communityTemplateDetailSchema.parse({
        ...toTemplate(row),
        content: validation.content,
      }),
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------------------------------------------------------------------------
// Import (isolation: writes only into the importer's own project)
// ---------------------------------------------------------------------------

export async function importCommunityTemplate(
  workspaceId: string,
  projectId: string,
  templateId: string,
  input: unknown,
): Promise<ActionResult<{ suiteId: string; caseCount: number }>> {
  const parsed = z.object({ suiteName: createSuiteSchema.shape.name }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return { ok: false, error: TEMPLATE_NOT_FOUND };

    const { data } = await supabase
      .from("community_templates")
      .select(`${TEMPLATE_COLUMNS},content`)
      .eq("id", templateId)
      .maybeSingle();
    if (!data) return { ok: false, error: TEMPLATE_NOT_FOUND };
    const row = data as TemplateRow;
    if (row.status !== "published") return { ok: false, error: TEMPLATE_NOT_FOUND };

    // Re-validate at import time — stored content is never trusted.
    const validation = validateTemplateContent(row.content);
    if (!validation.ok) {
      return { ok: false, error: "This template failed validation and cannot be imported." };
    }
    const content = validation.content;

    const { data: suite, error: suiteError } = await supabase
      .from("suites")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        name: parsed.data.suiteName,
        description: `Imported from community template "${row.name}" by ${row.author_display_name} (${row.license}).`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (suiteError || !suite) return { ok: false, error: UNEXPECTED };
    const suiteId = (suite as { id: string }).id;

    const caseRows = content.cases.map((c) => ({
      workspace_id: workspaceId,
      suite_id: suiteId,
      title: c.title,
      description: "",
      preconditions: c.preconditions || null,
      steps: c.steps,
      expected_results: c.expectedResults,
      priority: c.priority,
      tags: [c.testType, c.area, c.coverage],
      status: "draft",
      objective: c.objective,
      coverage: c.coverage,
      assumptions: c.assumptions,
      created_by: userId,
    }));

    const { error: casesError } = await supabase.from("test_cases").insert(caseRows);
    if (casesError) {
      await supabase.from("suites").delete().eq("id", suiteId);
      return { ok: false, error: UNEXPECTED };
    }

    try {
      await supabase.rpc("bump_community_template_imports", { p_template_id: templateId });
    } catch {
      // Counting must never fail an import.
    }

    revalidatePath(`/dashboard/projects/${projectId}/suites`);
    return { ok: true, data: { suiteId, caseCount: caseRows.length } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------------------------------------------------------------------------
// Report abuse
// ---------------------------------------------------------------------------

const reportInputSchema = z.object({
  reason: templateReportReasonSchema,
  details: z.string().trim().max(500).optional(),
});

export async function reportCommunityTemplate(
  workspaceId: string,
  templateId: string,
  input: unknown,
): Promise<ActionResult<{ reported: true }>> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);
    const { error } = await supabase.from("community_template_reports").insert({
      template_id: templateId,
      reporter_user_id: userId,
      reason: parsed.data.reason,
      details: parsed.data.details ?? null,
    });
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return { ok: false, error: "You already reported this template." };
      }
      return { ok: false, error: UNEXPECTED };
    }
    return { ok: true, data: { reported: true } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

// ---------------------------------------------------------------------------
// Author management
// ---------------------------------------------------------------------------

export async function listMyCommunityTemplates(
  workspaceId: string,
): Promise<ActionResult<CommunityTemplate[]>> {
  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("community_templates")
      .select(TEMPLATE_COLUMNS)
      .eq("author_user_id", userId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: UNEXPECTED };
    return { ok: true, data: ((data ?? []) as TemplateRow[]).map(toTemplate) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

async function getOwnTemplate(
  supabase: Awaited<ReturnType<typeof requireWorkspaceClient>>["supabase"],
  userId: string,
  templateId: string,
): Promise<TemplateRow | null> {
  const { data } = await supabase
    .from("community_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("id", templateId)
    .maybeSingle();
  const row = (data as TemplateRow | null) ?? null;
  // Non-authors get the same answer as a missing template.
  if (!row || row.author_user_id !== userId) return null;
  return row;
}

export async function unpublishCommunityTemplate(
  workspaceId: string,
  templateId: string,
): Promise<ActionResult<{ unpublished: true }>> {
  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);
    const row = await getOwnTemplate(supabase, userId, templateId);
    if (!row) return { ok: false, error: TEMPLATE_NOT_FOUND };
    const { error } = await supabase
      .from("community_templates")
      .update({ status: "removed" })
      .eq("id", templateId);
    if (error) return { ok: false, error: UNEXPECTED };
    revalidatePath("/dashboard/community");
    return { ok: true, data: { unpublished: true } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function deleteCommunityTemplate(
  workspaceId: string,
  templateId: string,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);
    const row = await getOwnTemplate(supabase, userId, templateId);
    if (!row) return { ok: false, error: TEMPLATE_NOT_FOUND };
    const { error } = await supabase.from("community_templates").delete().eq("id", templateId);
    if (error) return { ok: false, error: UNEXPECTED };
    revalidatePath("/dashboard/community");
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
