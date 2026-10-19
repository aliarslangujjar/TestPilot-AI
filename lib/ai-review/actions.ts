"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";
import { createTestCase } from "@/lib/test-cases/actions";
import { requireWorkspaceClient } from "@/lib/workspace-authz";
import { reviewSubmissionSchema } from "@schemas/ai-review";

/**
 * Persist human-approved generated cases — as drafts, exactly as approved.
 *
 * - Only tempIds in `approvedTempIds` are saved; everything else is dropped.
 * - `status` is forced to "draft": generated cases are never saved as
 *   active and never count as coverage until they are executed.
 * - The approved content is passed through untouched: the only
 *   transformation is the forced draft status (declared, not silent).
 */

const NO_ACCESS = "You don't have access to this workspace.";
const UNEXPECTED = "Something went wrong. Please try again.";
const SUITE_NOT_FOUND = "Suite not found.";

function toError(error: unknown): string {
  if (error instanceof WorkspaceAccessDeniedError) return NO_ACCESS;
  return UNEXPECTED;
}

export async function saveReviewedCases(
  input: unknown,
): Promise<ActionResult<{ created: number; ids: string[] }>> {
  const parsed = reviewSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }
  const { workspaceId, projectId, suiteId, cases, approvedTempIds } = parsed.data;

  const byTempId = new Map(cases.map((c) => [c.tempId, c]));
  for (const tempId of approvedTempIds) {
    if (!byTempId.has(tempId)) {
      return { ok: false, error: "An approved case is missing from the submission." };
    }
  }

  try {
    const { supabase } = await requireWorkspaceClient(workspaceId);
    const { data: suite, error: suiteError } = await supabase
      .from("suites")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", suiteId)
      .maybeSingle();
    if (suiteError || !suite) return { ok: false, error: SUITE_NOT_FOUND };

    const ids: string[] = [];
    for (const tempId of approvedTempIds) {
      const c = byTempId.get(tempId)!;
      const result = await createTestCase(workspaceId, projectId, suiteId, {
        title: c.title,
        description: c.description,
        preconditions: c.preconditions,
        steps: c.steps,
        expectedResults: c.expectedResults,
        priority: c.priority,
        tags: c.tags,
        status: "draft",
      });
      if (!result.ok) return { ok: false, error: result.error };
      ids.push(result.data.id);
    }
    revalidatePath(`/dashboard/projects/${projectId}/suites`);
    return { ok: true, data: { created: ids.length, ids } };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
