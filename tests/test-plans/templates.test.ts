/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { getPlanTemplate, listPlanTemplates, PLAN_TEMPLATES } from "@/lib/test-plans/templates";
import { testTypeSchema } from "@schemas/test-plan";

describe("plan templates", () => {
  it("ships at least five templates with unique keys", () => {
    const keys = PLAN_TEMPLATES.map((t) => t.key);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the common app types", () => {
    const keys = PLAN_TEMPLATES.map((t) => t.key);
    for (const expected of [
      "general-web-app",
      "ecommerce",
      "saas-dashboard",
      "auth",
      "rest-api",
      "content-site",
    ]) {
      expect(keys).toContain(expected);
    }
  });

  it("every template has valid default test types and coverage areas", () => {
    for (const t of PLAN_TEMPLATES) {
      expect(t.defaultTestTypes.length).toBeGreaterThan(0);
      for (const type of t.defaultTestTypes) {
        expect(testTypeSchema.safeParse(type).success).toBe(true);
      }
      expect(t.defaultCoverageAreas.length).toBeGreaterThan(0);
      expect(t.defaultCoverageAreas.length).toBeLessThanOrEqual(10);
      expect(t.promptGuidance.length).toBeGreaterThan(0);
    }
  });

  it("ecommerce defaults include checkout and security", () => {
    const t = getPlanTemplate("ecommerce");
    expect(t?.defaultCoverageAreas).toContain("Checkout");
    expect(t?.defaultTestTypes).toContain("security");
  });

  it("returns null for an unknown template key", () => {
    expect(getPlanTemplate("nope")).toBeNull();
    expect(listPlanTemplates()).toBe(PLAN_TEMPLATES);
  });
});
