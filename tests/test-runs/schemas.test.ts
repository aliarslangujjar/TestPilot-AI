import { describe, expect, it } from "vitest";

import {
  createRunSchema,
  resultOutcomeSchema,
  runStatusSchema,
  updateResultSchema,
} from "@schemas/test-run";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("run schemas", () => {
  it("requires a run name between 2 and 100 characters", () => {
    expect(createRunSchema.safeParse({ name: "x", testCaseIds: [UUID] }).success).toBe(false);
    expect(createRunSchema.safeParse({ name: "Sprint 1", testCaseIds: [UUID] }).success).toBe(true);
  });

  it("requires at least one and at most 500 test cases", () => {
    expect(createRunSchema.safeParse({ name: "Sprint 1", testCaseIds: [] }).success).toBe(false);
    expect(createRunSchema.safeParse({ name: "Sprint 1", testCaseIds: [UUID] }).success).toBe(true);
    expect(
      createRunSchema.safeParse({ name: "Sprint 1", testCaseIds: Array(501).fill(UUID) }).success,
    ).toBe(false);
  });

  it("accepts the four manual outcomes plus unexecuted", () => {
    for (const outcome of ["unexecuted", "pass", "fail", "blocked", "skipped"]) {
      expect(resultOutcomeSchema.safeParse(outcome).success).toBe(true);
    }
    expect(resultOutcomeSchema.safeParse("passed").success).toBe(false);
  });

  it("accepts only the defined run statuses", () => {
    expect(runStatusSchema.safeParse("in_progress").success).toBe(true);
    expect(runStatusSchema.safeParse("completed").success).toBe(true);
    expect(runStatusSchema.safeParse("archived").success).toBe(false);
  });

  it("limits result notes to 2000 characters", () => {
    expect(updateResultSchema.safeParse({ outcome: "fail", notes: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(updateResultSchema.safeParse({ outcome: "fail" }).success).toBe(true);
  });
});
