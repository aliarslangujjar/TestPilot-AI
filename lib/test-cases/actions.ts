"use server";

import { revalidatePath } from "next/cache";

import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import type { ActionResult } from "@/lib/action-result";
import {
  createTestCaseSchema,
  testCasePrioritySchema,
  testCaseStatusSchema,
  updateTestCaseSchema,
  type CreateTestCaseInput,
  type TestCase,
  type TestCaseStep,
  type UpdateTestCaseInput,
} from "@schemas/test-case";

/**
 * Test-case CRUD, executed on the server.
 *
 * Same enforcement model as projects and suites: validate input, prove
 * workspace membership (indistinguishable denial), scope every query to
 * workspace_id (and suite_id), RLS as the final backstop. Archiving is
 * soft — the full history stays readable. AI generation and browser
 * execution are deferred; these cases are manual.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Test case not found.";
const SUITE_NOT_FOUND = "Suite not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

interface TestCaseRow {
  id: string;
  workspace_id: string;
  suite_id: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  steps: Array<{ action: string; expected: string | null }>;
  expected_results: string | null;
  priority: TestCase["priority"];
  tags: string[];
  status: TestCase["status"];
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const TEST_CASE_COLUMNS =
  "id,workspace_id,suite_id,title,description,preconditions,steps,expected_results,priority,tags,status,is_archived,created_by,created_at,updated_at";

function toTestCase(row: TestCaseRow): TestCase {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    suiteId: row.suite_id,
    title: row.title,
    description: row.description,
    preconditions: row.preconditions,
    steps: (row.steps ?? []).map((s) => ({
      action: s.action,
      expected: s.expected ?? null,
    })),
    expectedResults: row.expected_results,
    priority: row.priority,
    tags: row.tags ?? [],
    status: row.status,
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
  return UNEXPECTED;
}

type WorkspaceClient = Awaited<ReturnType<typeof requireWorkspaceClient>>;

/** Loads the suite scoped to the workspace, or returns null. */
async function getScopedSuite(client: WorkspaceClient, workspaceId: string, suiteId: string) {
  const { data, error } = await client.supabase
    .from("suites")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", suiteId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function revalidate(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}/suites`);
}

export interface TestCaseFilters {
  includeArchived?: boolean;
  search?: string;
  status?: TestCase["status"];
  priority?: TestCase["priority"];
  tags?: string[];
}

export async function listTestCases(
  workspaceId: string,
  projectId: string,
  suiteId: string,
  filters?: TestCaseFilters,
): Promise<ActionResult<TestCase[]>> {
  try {
    const status = filters?.status ? testCaseStatusSchema.parse(filters.status) : undefined;
    const priority = filters?.priority ? testCasePrioritySchema.parse(filters.priority) : undefined;
    const client = await requireWorkspaceClient(workspaceId);
    if (!(await getScopedSuite(client, workspaceId, suiteId))) {
      return { ok: false, error: SUITE_NOT_FOUND };
    }
    let query = client.supabase
      .from("test_cases")
      .select(TEST_CASE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("suite_id", suiteId);
    if (!filters?.includeArchived) {
      query = query.eq("is_archived", false);
    }
    const search = filters?.search?.trim();
    if (search) {
      query = query.ilike("title", `%${escapeLike(search)}%`);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (priority) {
      query = query.eq("priority", priority);
    }
    if (filters?.tags && filters.tags.length > 0) {
      query = query.overlaps("tags", filters.tags);
    }
    query = query.order("updated_at", { ascending: false });
    const { data, error } = await query;
    if (error) return { ok: false, error: toError(error) };
    return { ok: true, data: (data as TestCaseRow[]).map(toTestCase) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function getTestCase(
  workspaceId: string,
  suiteId: string,
  caseId: string,
): Promise<ActionResult<TestCase>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data, error } = await client.supabase
      .from("test_cases")
      .select(TEST_CASE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("suite_id", suiteId)
      .eq("id", caseId)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    return { ok: true, data: toTestCase(data as TestCaseRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

function toRowInput(data: CreateTestCaseInput | UpdateTestCaseInput) {
  return {
    title: data.title,
    description: data.description ?? null,
    preconditions: data.preconditions ?? null,
    // Defaults are applied by safeParse before this runs; ?? is belt-and-braces.
    steps: (data.steps ?? []) as TestCaseStep[],
    expected_results: data.expectedResults ?? null,
    priority: data.priority ?? "medium",
    tags: data.tags ?? [],
    status: data.status ?? "draft",
  };
}

export async function createTestCase(
  workspaceId: string,
  projectId: string,
  suiteId: string,
  input: CreateTestCaseInput,
): Promise<ActionResult<TestCase>> {
  const parsed = createTestCaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? UNEXPECTED };
  }
  try {
    const client = await requireWorkspaceClient(workspaceId);
    if (!(await getScopedSuite(client, workspaceId, suiteId))) {
      return { ok: false, error: SUITE_NOT_FOUND };
    }
    const { data, error } = await client.supabase
      .from("test_cases")
      .insert({
        workspace_id: workspaceId,
        suite_id: suiteId,
        created_by: client.userId,
        ...toRowInput(parsed.data),
      })
      .select(TEST_CASE_COLUMNS)
      .single();
    if (error) return { ok: false, error: toError(error) };
    revalidate(projectId);
    return { ok: true, data: toTestCase(data as TestCaseRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function updateTestCase(
  workspaceId: string,
  projectId: string,
  suiteId: string,
  caseId: string,
  input: UpdateTestCaseInput,
): Promise<ActionResult<TestCase>> {
  const parsed = updateTestCaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? UNEXPECTED };
  }
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data, error } = await client.supabase
      .from("test_cases")
      .update(toRowInput(parsed.data))
      .eq("workspace_id", workspaceId)
      .eq("suite_id", suiteId)
      .eq("id", caseId)
      .select(TEST_CASE_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    revalidate(projectId);
    return { ok: true, data: toTestCase(data as TestCaseRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function setTestCaseArchived(
  workspaceId: string,
  projectId: string,
  suiteId: string,
  caseId: string,
  archived: boolean,
): Promise<ActionResult<TestCase>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data, error } = await client.supabase
      .from("test_cases")
      .update({ is_archived: archived })
      .eq("workspace_id", workspaceId)
      .eq("suite_id", suiteId)
      .eq("id", caseId)
      .select(TEST_CASE_COLUMNS)
      .maybeSingle();
    if (error) return { ok: false, error: toError(error) };
    if (!data) return { ok: false, error: NOT_FOUND };
    revalidate(projectId);
    return { ok: true, data: toTestCase(data as TestCaseRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

/**
 * Duplicates a test case inside its suite. The copy starts as a draft for
 * review; history is preserved because the source case is untouched.
 */
export async function duplicateTestCase(
  workspaceId: string,
  projectId: string,
  suiteId: string,
  caseId: string,
): Promise<ActionResult<TestCase>> {
  try {
    const client = await requireWorkspaceClient(workspaceId);
    const { data: source, error: sourceError } = await client.supabase
      .from("test_cases")
      .select(TEST_CASE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("suite_id", suiteId)
      .eq("id", caseId)
      .maybeSingle();
    if (sourceError) return { ok: false, error: toError(sourceError) };
    if (!source) return { ok: false, error: NOT_FOUND };
    const row = source as TestCaseRow;
    const { data, error } = await client.supabase
      .from("test_cases")
      .insert({
        workspace_id: workspaceId,
        suite_id: suiteId,
        title: `${row.title} (copy)`,
        description: row.description,
        preconditions: row.preconditions,
        steps: row.steps,
        expected_results: row.expected_results,
        priority: row.priority,
        tags: row.tags,
        status: "draft",
        created_by: client.userId,
      })
      .select(TEST_CASE_COLUMNS)
      .single();
    if (error) return { ok: false, error: toError(error) };
    revalidate(projectId);
    return { ok: true, data: toTestCase(data as TestCaseRow) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
