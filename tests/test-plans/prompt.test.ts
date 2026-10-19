/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  buildTestPlanUserPrompt,
  estimateTestPlanUsage,
  TEST_PLAN_SYSTEM_PROMPT,
} from "@/lib/test-plans/prompt";

describe("test-plan prompt", () => {
  const base = {
    sourceKind: "user_story" as const,
    sourceText: "As a user I want to log in.",
    maxCases: 8,
    includeNegative: true,
    includeBoundary: true,
  };

  it("asks for the requested coverage classes and the case cap", () => {
    const prompt = buildTestPlanUserPrompt(base);
    expect(prompt).toContain("at most 8 test cases");
    expect(prompt).toContain("Include negative cases");
    expect(prompt).toContain("Include boundary cases");
    expect(prompt).toContain("As a user I want to log in.");
  });

  it("omits coverage classes the user deselected", () => {
    const prompt = buildTestPlanUserPrompt({ ...base, includeNegative: false });
    expect(prompt).toContain("Do not include negative cases");
  });

  it("forbids execution claims in the system prompt", () => {
    expect(TEST_PLAN_SYSTEM_PROMPT).toContain("not executed");
    expect(TEST_PLAN_SYSTEM_PROMPT).toMatch(/never claim/i);
  });

  it("estimates usage from source length and case count", () => {
    const small = estimateTestPlanUsage("x".repeat(100), 4, "openai");
    const large = estimateTestPlanUsage("x".repeat(100), 8, "openai");
    expect(large.outputTokens).toBeGreaterThan(small.outputTokens);
    expect(large.inputTokens).toBe(small.inputTokens);
    expect(small.costUsd).toBeGreaterThan(0);
    // Anthropic's higher rates cost more for the same shape.
    const anthropic = estimateTestPlanUsage("x".repeat(100), 4, "anthropic");
    expect(anthropic.costUsd).toBeGreaterThan(small.costUsd);
  });
});
