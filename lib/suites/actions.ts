"use server";

import { revalidatePath } from "next/cache";

import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import type { ActionResult } from "@/lib/action-result";
import {
  createSuiteSchema,
  updateSuiteSchema,
  type CreateSuiteInput,
  type Suite,
  type UpdateSuiteInput,
} from "@schemas/suite";

/**
 * Suite CRUD, executed on the server.
 *
 * Same enforcement model as projects: validate input, prove workspace
 * membership (indistinguishable denial), scope every query to workspace_id
 * (and project_id), RLS as the final backstop. Archiving is soft — history
 * is never deleted.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Suite not found.";
const PROJECT_NOT_FOUND = "Project not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

interface SuiteRow {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const SUITE_COLUMNS =
  "id,workspace_id,project_id,name,description,is_archived,created_by,created_at,updated_at";

function toSuite(row: SuiteRow): Suite {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    isArchived: row.is_archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  ) {
    return "A suite with this name already exists in this project.";
  }
  return UNEXPECTED;
}

type WorkspaceClient = Awaited<ReturnType<typeof requireWorkspaceClient>>;

/** Loads the project scoped to the workspace, or returns null. */
async function getScopedProject(client: WorkspaceClient, workspaceId: string, projectId: string) {
  const { data, error } = await client.supabase
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function revalidate(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}/suites`);
}

export async function listSuites(
  workspaceId: string,
  projectId: string,
  opts?: { includeArchived?: boolean; search?: string },
): Promise<ActionResult<Suite[]>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    if (!(await getScopedProject(client, workspaceId, projectId))) {
      return { ok: false, error: PROJECT_NOT_FOUND };
    }
    let query = client.supabase
      .from("suites")
      .select(SUITE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId);
    if (!opts?.includeArchived) {
      query = query.eq("is_archived", false);
    }
    const search = opts?.search?.trim();
    if (search) {
      query = query.ilike("name", `%${escapeLike(search)}%`);
    }
    query = query.order("updated_at", { ascending: false });
    const { data, error } = await query;
    if (error) return { ok: false, error: toError(error) };
    return { ok: true, data: (data as SuiteRow[]).map(toSuite) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function getSuite(
  workspaceId: string,
  projectId: string,
  suiteId: string,
): Promise<ActionResult<Suite>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data, error } = await client.supabase
      .from("suites")
      .select(SUITE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", suiteId)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    return { ok: true, data: toSuite(data as SuiteRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function createSuite(
  workspaceId: string,
  projectId: string,
  input: CreateSuiteInput,
): Promise<ActionResult<Suite>> {
  const parsed = createSuiteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? UNEXPECTED };
  }
  try {
    const client = await requireWorkspaceClient(workspaceId);
    if (!(await getScopedProject(client, workspaceId, projectId))) {
      return { ok: false, error: PROJECT_NOT_FOUND };
    }
    const { data, error } = await client.supabase
      .from("suites")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        created_by: client.userId,
      })
      .select(SUITE_COLUMNS)
      .single();
    if (error) return { ok: false, error: toError(error) };
    revalidate(projectId);
    return { ok: true, data: toSuite(data as SuiteRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function updateSuite(
  workspaceId: string,
  projectId: string,
  suiteId: string,
  input: UpdateSuiteInput,
): Promise<ActionResult<Suite>> {
  const parsed = updateSuiteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? UNEXPECTED };
  }
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data, error } = await client.supabase
      .from("suites")
      .update({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", suiteId)
      .select(SUITE_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    revalidate(projectId);
    return { ok: true, data: toSuite(data as SuiteRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function setSuiteArchived(
  workspaceId: string,
  projectId: string,
  suiteId: string,
  archived: boolean,
): Promise<ActionResult<Suite>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data, error } = await client.supabase
      .from("suites")
      .update({ is_archived: archived })
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", suiteId)
      .select(SUITE_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    revalidate(projectId);
    return { ok: true, data: toSuite(data as SuiteRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

/**
 * Duplicates a suite together with its non-archived test cases. The copy
 * starts unarchived and its cases start as drafts for review. History is
 * preserved: the source suite and its cases are untouched.
 */
export async function duplicateSuite(
  workspaceId: string,
  projectId: string,
  suiteId: string,
): Promise<ActionResult<Suite>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data: source, error: sourceError } = await client.supabase
      .from("suites")
      .select(SUITE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", suiteId)
      .maybeSingle();
    if (sourceError) return { ok: false, error: toError(sourceError) };
    if (!source) return { ok: false, error: NOT_FOUND };

    const { data: newSuite, error: insertError } = await client.supabase
      .from("suites")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        name: `${(source as SuiteRow).name} (copy)`,
        description: (source as SuiteRow).description,
        created_by: client.userId,
      })
      .select(SUITE_COLUMNS)
      .single();
    if (insertError) return { ok: false, error: toError(insertError) };

    const { data: cases, error: casesError } = await client.supabase
      .from("test_cases")
      .select("title,description,preconditions,steps,expected_results,priority,tags")
      .eq("workspace_id", workspaceId)
      .eq("suite_id", suiteId)
      .eq("is_archived", false);
    if (casesError) return { ok: false, error: toError(casesError) };

    for (const testCase of (cases ?? []) as Array<{
      title: string;
      description: string | null;
      preconditions: string | null;
      steps: unknown;
      expected_results: string | null;
      priority: string;
      tags: string[];
    }>) {
      const { error: copyError } = await client.supabase.from("test_cases").insert({
        workspace_id: workspaceId,
        suite_id: (newSuite as SuiteRow).id,
        title: `${testCase.title} (copy)`,
        description: testCase.description,
        preconditions: testCase.preconditions,
        steps: testCase.steps,
        expected_results: testCase.expected_results,
        priority: testCase.priority,
        tags: testCase.tags,
        status: "draft",
        created_by: client.userId,
      });
      if (copyError) return { ok: false, error: toError(copyError) };
    }

    revalidate(projectId);
    return { ok: true, data: toSuite(newSuite as SuiteRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
