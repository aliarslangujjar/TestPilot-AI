/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { createSuiteSchema, suiteDescriptionSchema, suiteNameSchema } from "@schemas/suite";
import {
  createTestCaseSchema,
  testCasePreconditionsSchema,
  testCasePrioritySchema,
  testCaseStatusSchema,
  testCaseStepsSchema,
  testCaseTagsSchema,
  testCaseTitleSchema,
} from "@schemas/test-case";

describe("suite validation schemas", () => {
  it("accepts a valid suite", () => {
    expect(
      createSuiteSchema.safeParse({ name: "Smoke tests", description: "Fast checks." }).success,
    ).toBe(true);
  });

  it("rejects names outside 2–100 characters", () => {
    expect(suiteNameSchema.safeParse("A").success).toBe(false);
    expect(suiteNameSchema.safeParse("A".repeat(101)).success).toBe(false);
    expect(suiteNameSchema.safeParse("AB").success).toBe(true);
  });

  it("allows an absent description", () => {
    expect(suiteDescriptionSchema.safeParse(undefined).success).toBe(true);
    expect(suiteDescriptionSchema.safeParse(null).success).toBe(true);
  });
});

describe("test-case validation schemas", () => {
  const validStep = { action: "Click submit", expected: "Form validates" };

  it("accepts a minimal test case", () => {
    expect(createTestCaseSchema.safeParse({ title: "Login works" }).success).toBe(true);
  });

  it("applies defaults for steps, priority, tags, and status", () => {
    const result = createTestCaseSchema.safeParse({ title: "Login works" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([]);
      expect(result.data.priority).toBe("medium");
      expect(result.data.tags).toEqual([]);
      expect(result.data.status).toBe("draft");
    }
  });

  it("rejects titles outside 2–200 characters", () => {
    expect(testCaseTitleSchema.safeParse("A").success).toBe(false);
    expect(testCaseTitleSchema.safeParse("A".repeat(201)).success).toBe(false);
  });

  it("accepts well-formed steps", () => {
    expect(testCaseStepsSchema.safeParse([validStep, { action: "Only action" }]).success).toBe(
      true,
    );
  });

  it("rejects steps with empty actions", () => {
    expect(testCaseStepsSchema.safeParse([{ action: "  " }]).success).toBe(false);
    expect(testCaseStepsSchema.safeParse([{ action: "", expected: "x" }]).success).toBe(false);
  });

  it("rejects more than 100 steps", () => {
    const steps = Array.from({ length: 101 }, (_, i) => ({ action: `Step ${i}` }));
    expect(testCaseStepsSchema.safeParse(steps).success).toBe(false);
  });

  it("rejects unknown priorities and statuses", () => {
    expect(testCasePrioritySchema.safeParse("urgent").success).toBe(false);
    expect(testCaseStatusSchema.safeParse("archived").success).toBe(false);
    expect(testCasePrioritySchema.safeParse("critical").success).toBe(true);
    expect(testCaseStatusSchema.safeParse("active").success).toBe(true);
  });

  it("rejects empty or oversized tags", () => {
    expect(testCaseTagsSchema.safeParse([""]).success).toBe(false);
    expect(testCaseTagsSchema.safeParse(["  "]).success).toBe(false);
    expect(testCaseTagsSchema.safeParse(["x".repeat(51)]).success).toBe(false);
    expect(
      testCaseTagsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `t${i}`)).success,
    ).toBe(false);
    expect(testCaseTagsSchema.safeParse(["smoke", "login"]).success).toBe(true);
  });

  it("rejects overlong preconditions", () => {
    expect(testCasePreconditionsSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });

  it("accepts a fully-specified test case", () => {
    const result = createTestCaseSchema.safeParse({
      title: "Login rejects wrong password",
      description: "Covers the negative path.",
      preconditions: "Account exists; user is signed out.",
      steps: [validStep],
      expectedResults: "User stays signed out with an error.",
      priority: "high",
      tags: ["smoke", "login"],
      status: "active",
    });
    expect(result.success).toBe(true);
  });
});
