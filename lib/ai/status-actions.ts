"use server";

import { getAIStatus as readAIStatus, type AIStatus } from "./service";

/**
 * The ONLY function of the AI service exposed as a server action.
 *
 * lib/ai/service.ts is deliberately a plain server module (not
 * "use server"): while it carried that directive, generateStructured
 * was directly invocable by any signed-in user as an action, bypassing
 * the feature flows (test-plan generation, failure analysis) that
 * construct prompts deliberately. The status read the plan-generation
 * dialog needs lives here instead — it takes no input and discloses
 * only provider/model/demo configuration state.
 */
export async function getAIStatus(): Promise<AIStatus> {
  return readAIStatus();
}
