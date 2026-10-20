"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { AIServiceError, type AIErrorCode } from "@/lib/ai/errors";
import { generateStructured, getAIStatus } from "@/lib/ai/service";
import { createSuiteSchema } from "@schemas/suite";
import {
  generatedPlanSchema,
  planGenerationRequestSchema,
  storedTestPlanSchema,
  type GeneratedPlan,
  type StoredTestPlan,
  type TestType,
} from "@schemas/test-plan";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";

import {
  buildStoredPlanUserPrompt,
  estimateTestPlanUsage,
  STORED_PLAN_SYSTEM_PROMPT,
} from "./prompt";
import { getPlanTemplate } from "./templates";

/**
 * Stored test plans: template-guided AI generation persisted to
 * `test_plans`, plus conversion into a suite of draft test cases.
 *
 * Generation persists ONLY after the provider output validates — a failed
 * or disabled generation stores nothing. Converted cases are drafts:
 * a plan is planning material, never executed coverage.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const PROJECT_NOT_FOUND = "Project not found.";
const PLAN_NOT_FOUND = "Test plan not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const PLAN_COLUMNS =
  "id,workspace_id,project_id,name,template_key,source_kind,source_text,settings,plan,model,status,suite_id,created_by,created_at,updated_at";

interface PlanRow {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  template_key: string;
  source_kind: StoredTestPlan["sourceKind"];
  source_text: string;
  settings: unknown;
  plan: unknown;
  model: string | null;
  status: StoredTestPlan["status"];
  suite_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toStoredPlan(row: PlanRow): StoredTestPlan {
  const parsed = storedTestPlanSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    templateKey: row.template_key,
    sourceKind: row.source_kind,
    sourceText: row.source_text,
    settings: row.settings,
    plan: row.plan,
    model: row.model,
    status: row.status,
    suiteId: row.suite_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return parsed;
}

type PlanGenerationOutcome = ActionResult<{
  plan: StoredTestPlan;
  estimate: { inputTokens: number; outputTokens: number; costUsd: number };
  usage: { inputTokens: number; outputTokens: number };
}> & { code?: AIErrorCode };

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

/** Strict post-validation beyond the zod parse of the provider output. */
function validateGeneratedOrThrow(
  plan: GeneratedPlan,
  req: { maxCases: number; testTypes: TestType[] },
) {
  const fail = (message: string) => {
    throw new AIServiceError("AI_INVALID_RESPONSE", message);
  };
  if (plan.cases.length === 0) fail("The AI returned no test cases.");
  if (plan.cases.length > req.maxCases) {
    fail(`The AI returned ${plan.cases.length} cases (max ${req.maxCases}).`);
  }
  const present = new Set(plan.cases.map((c) => c.testType));
  for (const t of req.testTypes) {
    if (!present.has(t)) fail(`The AI returned no ${t} cases although they were requested.`);
  }
}

export async function generateAndStoreTestPlan(input: unknown): Promise<PlanGenerationOutcome> {
  const parsed = planGenerationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const req = parsed.data;

  const template = getPlanTemplate(req.templateKey);
  if (!template) return { ok: false, error: "Unknown template." };

  try {
    const { supabase, userId } = await requireWorkspaceClient(req.workspaceId);

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("workspace_id", req.workspaceId)
      .eq("id", req.projectId)
      .maybeSingle();
    if (!project) return { ok: false, error: PROJECT_NOT_FOUND };

    const status = await getAIStatus();
    const estimate = estimateTestPlanUsage(req.sourceText, req.maxCases, status.provider);

    const { data: plan, usage } = await generateStructured({
      workspaceId: req.workspaceId,
      system: STORED_PLAN_SYSTEM_PROMPT,
      prompt: buildStoredPlanUserPrompt({
        sourceKind: req.sourceKind,
        sourceText: req.sourceText,
        maxCases: req.maxCases,
        testTypes: req.testTypes,
        coverageAreas: req.coverageAreas,
        priorityStrategy: req.priorityStrategy,
        templateGuidance: template.promptGuidance,
      }),
      schema: generatedPlanSchema,
      label: "test-plan-generation",
    });

    validateGeneratedOrThrow(plan, req);

    // Canonicalize area strings against the requested areas (case-insensitive
    // match); anything else is kept as the model phrased it.
    const canonical = new Map(req.coverageAreas.map((a) => [a.toLowerCase(), a] as const));
    const storedPlan: GeneratedPlan = {
      summary: plan.summary,
      cases: plan.cases.map((c) => ({
        ...c,
        area: canonical.get(c.area.toLowerCase()) ?? c.area,
      })),
    };

    const { data: row, error } = await supabase
      .from("test_plans")
      .insert({
        workspace_id: req.workspaceId,
        project_id: req.projectId,
        name: req.name,
        template_key: req.templateKey,
        source_kind: req.sourceKind,
        source_text: req.sourceText,
        settings: {
          testTypes: req.testTypes,
          coverageAreas: req.coverageAreas,
          priorityStrategy: req.priorityStrategy,
          maxCases: req.maxCases,
        },
        plan: storedPlan,
        model: status.model,
        status: "draft",
        created_by: userId,
      })
      .select(PLAN_COLUMNS)
      .single();
    if (error) return { ok: false, error: UNEXPECTED };

    revalidatePath(`/dashboard/projects/${req.projectId}/plans`);
    return { ok: true, data: { plan: toStoredPlan(row as PlanRow), estimate, usage } };
  } catch (error) {
    if (error instanceof AIServiceError)
      return { ok: false, error: error.message, code: error.code };
    return { ok: false, error: toError(error) };
  }
}

/**
 * Pre-generation usage estimate for the UI. Does not generate anything.
 */
export async function getPlanGenerationEstimate(
  workspaceId: string,
  sourceText: string,
  maxCases: number,
): Promise<
  ActionResult<{ inputTokens: number; outputTokens: number; costUsd: number; enabled: boolean }>
> {
  try {
    await requireWorkspaceClient(workspaceId);
    const status = await getAIStatus();
    const estimate = estimateTestPlanUsage(
      sourceText,
      Math.min(Math.max(maxCases, 1), 30),
      status.provider,
    );
    return { ok: true, data: { ...estimate, enabled: status.enabled } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

async function getScopedPlan(
  supabase: Awaited<ReturnType<typeof requireWorkspaceClient>>["supabase"],
  workspaceId: string,
  projectId: string,
  planId: string,
): Promise<PlanRow | null> {
  const { data } = await supabase
    .from("test_plans")
    .select(PLAN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("id", planId)
    .maybeSingle();
  return (data as PlanRow | null) ?? null;
}

export async function listTestPlans(
  workspaceId: string,
  projectId: string,
): Promise<ActionResult<StoredTestPlan[]>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data, error } = await supabase
      .from("test_plans")
      .select(PLAN_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: UNEXPECTED };
    return { ok: true, data: ((data ?? []) as PlanRow[]).map(toStoredPlan) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function getTestPlan(
  workspaceId: string,
  projectId: string,
  planId: string,
): Promise<ActionResult<StoredTestPlan>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const row = await getScopedPlan(supabase, workspaceId, projectId, planId);
    if (!row) return { ok: false, error: PLAN_NOT_FOUND };
    return { ok: true, data: toStoredPlan(row) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export async function deleteTestPlan(
  workspaceId: string,
  projectId: string,
  planId: string,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const row = await getScopedPlan(supabase, workspaceId, projectId, planId);
    if (!row) return { ok: false, error: PLAN_NOT_FOUND };
    const { error } = await supabase
      .from("test_plans")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", planId);
    if (error) return { ok: false, error: UNEXPECTED };
    revalidatePath(`/dashboard/projects/${projectId}/plans`);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

const convertInputSchema = z.object({
  suiteName: createSuiteSchema.shape.name,
});

/**
 * Convert a stored draft plan into a real suite + draft test cases.
 * One-way: an already-converted plan cannot be converted again (no
 * duplicate suites). If case insertion fails, the new suite is removed
 * again so no half-empty suite remains.
 */
export async function convertTestPlan(
  workspaceId: string,
  projectId: string,
  planId: string,
  input: unknown,
): Promise<ActionResult<{ suiteId: string; caseCount: number }>> {
  const parsedInput = convertInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: parsedInput.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const { supabase, userId } = await requireWorkspaceClient(workspaceId);
    const row = await getScopedPlan(supabase, workspaceId, projectId, planId);
    if (!row) return { ok: false, error: PLAN_NOT_FOUND };
    const stored = toStoredPlan(row);
    if (stored.status === "converted") {
      return { ok: false, error: "This plan was already converted to a suite." };
    }

    const { data: suite, error: suiteError } = await supabase
      .from("suites")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        name: parsedInput.data.suiteName,
        description: `Converted from test plan "${stored.name}" (${stored.templateKey} template).`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (suiteError || !suite) return { ok: false, error: UNEXPECTED };
    const suiteId = (suite as { id: string }).id;

    const caseRows = stored.plan.cases.map((c) => ({
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
      // Roll back the suite so a failed conversion leaves nothing behind.
      await supabase.from("suites").delete().eq("id", suiteId);
      return { ok: false, error: UNEXPECTED };
    }

    const { error: updateError } = await supabase
      .from("test_plans")
      .update({ status: "converted", suite_id: suiteId })
      .eq("workspace_id", workspaceId)
      .eq("id", planId);
    if (updateError) return { ok: false, error: UNEXPECTED };

    revalidatePath(`/dashboard/projects/${projectId}/plans`);
    revalidatePath(`/dashboard/projects/${projectId}/suites`);
    return { ok: true, data: { suiteId, caseCount: caseRows.length } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
