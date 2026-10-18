/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  createProjectSchema,
  projectBaseUrlSchema,
  projectDescriptionSchema,
  projectNameSchema,
  projectSearchSchema,
} from "@schemas/project";

describe("project validation schemas", () => {
  describe("projectNameSchema", () => {
    it("accepts names of 2–100 characters", () => {
      expect(projectNameSchema.safeParse("AB").success).toBe(true);
      expect(projectNameSchema.safeParse("A".repeat(100)).success).toBe(true);
    });

    it("rejects names that are too short or too long", () => {
      expect(projectNameSchema.safeParse("A").success).toBe(false);
      expect(projectNameSchema.safeParse("").success).toBe(false);
      expect(projectNameSchema.safeParse("A".repeat(101)).success).toBe(false);
    });

    it("trims surrounding whitespace", () => {
      expect(projectNameSchema.safeParse("  Billing API  ").data).toBe("Billing API");
    });
  });

  describe("projectDescriptionSchema", () => {
    it("is optional", () => {
      expect(projectDescriptionSchema.safeParse(undefined).success).toBe(true);
      expect(projectDescriptionSchema.safeParse(null).success).toBe(true);
    });

    it("rejects descriptions over 2000 characters", () => {
      expect(projectDescriptionSchema.safeParse("x".repeat(2001)).success).toBe(false);
    });
  });

  describe("projectBaseUrlSchema", () => {
    it("accepts http and https URLs", () => {
      expect(projectBaseUrlSchema.safeParse("https://staging.example.com").success).toBe(true);
      expect(projectBaseUrlSchema.safeParse("http://localhost:3000/app").success).toBe(true);
    });

    it("is optional", () => {
      expect(projectBaseUrlSchema.safeParse(undefined).success).toBe(true);
      expect(projectBaseUrlSchema.safeParse(null).success).toBe(true);
    });

    it("rejects non-http(s) and malformed URLs", () => {
      for (const url of ["ftp://files.example.com", "not a url", "example.com", ""]) {
        expect(projectBaseUrlSchema.safeParse(url).success, url || "(empty)").toBe(false);
      }
    });
  });

  describe("createProjectSchema", () => {
    it("accepts a minimal project", () => {
      const result = createProjectSchema.safeParse({ name: "Billing API" });
      expect(result.success).toBe(true);
    });

    it("accepts a fully-specified project", () => {
      const result = createProjectSchema.safeParse({
        name: "Billing API",
        description: "Covers invoicing flows.",
        baseUrl: "https://staging.example.com",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("projectSearchSchema", () => {
    it("rejects overly long search input", () => {
      expect(projectSearchSchema.safeParse("x".repeat(101)).success).toBe(false);
      expect(projectSearchSchema.safeParse("billing").success).toBe(true);
    });
  });
});
