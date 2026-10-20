"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { AIServiceError } from "@/lib/ai/errors";
import { generateStructured, getAIStatus } from "@/lib/ai/service";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import {
  failureAnalysisSchema,
  type FailureAnalysis,
  type FailureAnalysisSource,
} from "@schemas/ai-analysis";
import { browserJobResultSchema } from "@schemas/browser-job";
import { browserTestPlanSchema, type BrowserTestPlan } from "@schemas/browser-test";

import { buildFailureEvidence, type EvidenceJob } from "./evidence";
import { parseStoredFailureAnalysis, type StoredFailureAnalysis } from "./envelope";
import { fallbackAnalysis } from "./fallback";
import { buildFailureAnalysisPrompt, FAILURE_ANALYSIS_SYSTEM } from "./prompt";

/**
 * Failure analysis for failed/timed-out automated run results.
 *
 * Pipeline: membership → scoped run/result/job load → bounded,
 * sanitized evidence (lib/ai-analysis/evidence.ts) → AI when enabled
 * (metered by the shared AI service: quotas + usage log) or the
 * deterministic rule-based fallback when it is not → persist on the
 * result row with its source.
 *
 * The analysis is advisory: it never changes an outcome, and both the
 * AI prompt and the output schema forbid presenting a hypothesis as a
 * confirmed root cause.
 */

const NO_ACCESS = "You don't have access to this workspace.";
const NOT_FOUND = "Test run not found.";
const RESULT_NOT_FOUND = "Run result not found.";
const UNEXPECTED = "Something went wrong. Please try again.";

const uuidSchema = z.string().uuid();

interface ResultRow {
  id: string;
  execution_status: string | null;
  snapshot: { title: string };
  browser_job_id: string | null;
  failure_analysis: unknown;
}

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

async function loadScoped(
  workspaceId: string,
  projectId: string,
  runId: string,
  resultId: string,
): Promise<
  | { ok: true; evidence: ReturnType<typeof buildFailureEvidence>; result: ResultRow }
  | { ok: false; error: string }
> {
  const { supabase } = await requireWorkspaceClient(workspaceId);

  const { data: run } = await supabase
    .from("test_runs")
    .select("id,source")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("id", runId)
    .maybeSingle();
  if (!run || (run as { source: string }).source !== "automated") {
    return { ok: false, error: NOT_FOUND };
  }

  const { data: resultData } = await supabase
    .from("run_results")
    .select("id,execution_status,snapshot,browser_job_id,failure_analysis")
    .eq("workspace_id", workspaceId)
    .eq("run_id", runId)
    .eq("id", resultId)
    .maybeSingle();
  if (!resultData) return { ok: false, error: RESULT_NOT_FOUND };
  const result = resultData as ResultRow;

  if (result.execution_status !== "failed" && result.execution_status !== "timed_out") {
    return {
      ok: false,
      error: "Only failed or timed-out results can be analyzed.",
    };
  }
  if (!result.browser_job_id) {
    return { ok: false, error: "No worker job is linked to this result." };
  }

  const { data: jobData } = await supabase
    .from("browser_jobs")
    .select("status,failure_kind,attempts,error,plan,result")
    .eq("workspace_id", workspaceId)
    .eq("id", result.browser_job_id)
    .maybeSingle();
  if (!jobData) return { ok: false, error: "The linked worker job was not found." };
  const job = jobData as {
    status: string;
    failure_kind: EvidenceJob["failure_kind"];
    attempts: number;
    error: string | null;
    plan: unknown;
    result: unknown;
  };

  const plan = browserTestPlanSchema.safeParse(job.plan);
  if (!plan.success) return { ok: false, error: "The stored job plan is invalid." };
  const jobResult = browserJobResultSchema.safeParse(job.result);

  const evidence = buildFailureEvidence(
    { execution_status: result.execution_status, snapshot: result.snapshot },
    {
      status: job.status,
      failure_kind: job.failure_kind,
      attempts: job.attempts,
      error: job.error,
      plan: plan.data as BrowserTestPlan,
      result: jobResult.success ? jobResult.data : null,
    },
  );
  return { ok: true, evidence, result };
}

/**
 * Analyze one failed/timed-out result. Uses the metered AI service when
 * a provider is configured; otherwise the deterministic fallback. The
 * result is persisted on the run_results row with its source.
 */
export async function analyzeRunFailure(
  workspaceId: string,
  projectId: string,
  runId: string,
  resultId: string,
): Promise<ActionResult<StoredFailureAnalysis>> {
  if (
    !uuidSchema.safeParse(workspaceId).success ||
    !uuidSchema.safeParse(projectId).success ||
    !uuidSchema.safeParse(runId).success ||
    !uuidSchema.safeParse(resultId).success
  ) {
    return { ok: false, error: "Invalid workspace, project, run, or result." };
  }

  try {
    const loaded = await loadScoped(workspaceId, projectId, runId, resultId);
    if (!loaded.ok) return loaded;
    const { evidence } = loaded;

    const status = await getAIStatus();
    let analysis: FailureAnalysis;
    let source: FailureAnalysisSource;
    let model: string | null;

    if (status.enabled) {
      try {
        const generated = await generateStructured({
          workspaceId,
          system: FAILURE_ANALYSIS_SYSTEM,
          prompt: buildFailureAnalysisPrompt(evidence),
          schema: failureAnalysisSchema,
          label: "failure-analysis",
        });
        analysis = generated.data;
        source = "ai";
        model = status.model;
      } catch (error) {
        if (error instanceof AIServiceError) return { ok: false, error: error.message };
        throw error;
      }
    } else {
      // No-AI fallback: deterministic, pattern-based, clearly labelled.
      analysis = fallbackAnalysis(evidence);
      source = "fallback";
      model = null;
    }

    const envelope: StoredFailureAnalysis = {
      analysis,
      source,
      model,
      analyzedAt: new Date().toISOString(),
    };

    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { error: updateError } = await supabase
      .from("run_results")
      .update({
        failure_analysis: envelope,
        failure_analysis_source: source,
        failure_analyzed_at: envelope.analyzedAt,
      })
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .eq("id", resultId);
    if (updateError) return { ok: false, error: UNEXPECTED };

    revalidatePath(`/dashboard/projects/${projectId}/runs/${runId}`);
    return { ok: true, data: envelope };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

/** Read back a previously stored analysis (null when none exists). */
export async function getFailureAnalysis(
  workspaceId: string,
  projectId: string,
  runId: string,
  resultId: string,
): Promise<ActionResult<StoredFailureAnalysis | null>> {
  if (
    !uuidSchema.safeParse(workspaceId).success ||
    !uuidSchema.safeParse(projectId).success ||
    !uuidSchema.safeParse(runId).success ||
    !uuidSchema.safeParse(resultId).success
  ) {
    return { ok: false, error: "Invalid workspace, project, run, or result." };
  }

  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data: run } = await supabase
      .from("test_runs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .eq("id", runId)
      .maybeSingle();
    if (!run) return { ok: false, error: NOT_FOUND };

    const { data } = await supabase
      .from("run_results")
      .select("failure_analysis")
      .eq("workspace_id", workspaceId)
      .eq("run_id", runId)
      .eq("id", resultId)
      .maybeSingle();
    if (!data) return { ok: false, error: RESULT_NOT_FOUND };

    const stored = (data as { failure_analysis: unknown }).failure_analysis;
    return { ok: true, data: parseStoredFailureAnalysis(stored) };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
