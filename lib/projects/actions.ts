"use server";

import { revalidatePath } from "next/cache";

import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import type { ActionResult } from "@/lib/action-result";
import {
  createProjectSchema,
  projectSearchSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from "@schemas/project";

/**
 * Project CRUD, executed on the server.
 *
 * Every operation enforces workspace permissions twice: first explicitly via
 * assertWorkspaceMembership (indistinguishable denial), then by scoping every
 * query to workspace_id — with RLS as the final backstop. Input is validated
 * with the shared zod schemas before any database access.
 *
 * The base URL is stored as data only. Nothing here fetches it or executes
 * browser tests.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Project not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  base_url: string | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const PROJECT_COLUMNS =
  "id,workspace_id,name,description,base_url,is_archived,created_by,created_at,updated_at";

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    baseUrl: row.base_url,
    isArchived: row.is_archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Escape LIKE wildcards so search input can't alter the pattern semantics. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Local alias kept so the rest of this module reads unchanged. */
const workspaceClient = requireWorkspaceClient;

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  ) {
    return "A project with this name already exists in this workspace.";
  }
  return UNEXPECTED;
}

export async function listProjects(
  workspaceId: string,
  opts?: { search?: string; includeArchived?: boolean },
): Promise<ActionResult<Project[]>> {
  try {
    const search = opts?.search?.trim() ? projectSearchSchema.parse(opts.search.trim()) : "";
    const { supabase } = await workspaceClient(workspaceId);

    let query = supabase.from("projects").select(PROJECT_COLUMNS).eq("workspace_id", workspaceId);
    if (!opts?.includeArchived) {
      query = query.eq("is_archived", false);
    }
    if (search) {
      query = query.ilike("name", `%${escapeLike(search)}%`);
    }
    query = query.order("updated_at", { ascending: false });

    const { data, error } = await query;
    if (error) return { ok: false, error: toError(error) };
    return { ok: true, data: (data as ProjectRow[]).map(toProject) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function getProject(
  workspaceId: string,
  projectId: string,
): Promise<ActionResult<Project>> {
  try {
    const { supabase } = await workspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    return { ok: true, data: toProject(data as ProjectRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function createProject(
  workspaceId: string,
  input: CreateProjectInput,
): Promise<ActionResult<Project>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? UNEXPECTED };
  }
  try {
    const { supabase, userId } = await workspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        base_url: parsed.data.baseUrl ?? null,
        created_by: userId,
      })
      .select(PROJECT_COLUMNS)
      .single();
    if (error) return { ok: false, error: toError(error) };
    revalidatePath("/dashboard/projects");
    return { ok: true, data: toProject(data as ProjectRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function updateProject(
  workspaceId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<ActionResult<Project>> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? UNEXPECTED };
  }
  try {
    const { supabase } = await workspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("projects")
      .update({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        base_url: parsed.data.baseUrl ?? null,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .select(PROJECT_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    revalidatePath("/dashboard/projects");
    return { ok: true, data: toProject(data as ProjectRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function setProjectArchived(
  workspaceId: string,
  projectId: string,
  archived: boolean,
): Promise<ActionResult<Project>> {
  try {
    const { supabase } = await workspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("projects")
      .update({ is_archived: archived })
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .select(PROJECT_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    revalidatePath("/dashboard/projects");
    return { ok: true, data: toProject(data as ProjectRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
