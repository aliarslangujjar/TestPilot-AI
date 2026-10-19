/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { plannedCaseSchema, testPlanRequestSchema, testPlanSchema } from "@schemas/test-plan";

describe("test-plan schemas", () => {
  it("rejects source text that is too short", () => {
    const result = testPlanRequestSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      sourceKind: "user_story",
      sourceText: "too short",
    });
    expect(result.success).toBe(false);
  });

  it("applies generation defaults", () => {
    const result = testPlanRequestSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      sourceKind: "acceptance_criteria",
      sourceText: "a".repeat(100),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxCases).toBe(8);
      expect(result.data.includeNegative).toBe(true);
      expect(result.data.includeBoundary).toBe(true);
    }
  });

  it("requires every planned case to carry objective, coverage, and non-empty steps", () => {
    const result = plannedCaseSchema.safeParse({
      title: "Login works",
      objective: "",
      preconditions: "",
      steps: [{ action: "Submit", expected: "Dashboard" }],
      expectedResults: "Done",
      coverage: "positive",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid coverage class", () => {
    const result = plannedCaseSchema.safeParse({
      title: "Login works",
      objective: "Verifies login",
      preconditions: "",
      steps: [{ action: "Submit", expected: "Dashboard" }],
      expectedResults: "Done",
      coverage: "regression",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed plan", () => {
    const result = testPlanSchema.safeParse({
      summary: "Covers login happy path and invalid input.",
      cases: [
        {
          title: "Login with valid credentials",
          objective: "Verifies a valid user can sign in.",
          preconditions: "Account exists.",
          steps: [{ action: "Submit the form", expected: "Dashboard shows the username." }],
          expectedResults: "The user lands on the dashboard.",
          priority: "high",
          coverage: "positive",
          assumptions: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
