/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@schemas/auth";

describe("auth validation schemas", () => {
  describe("signInSchema", () => {
    it("accepts a valid email and any non-empty password", () => {
      expect(signInSchema.safeParse({ email: "user@example.com", password: "x" }).success).toBe(
        true,
      );
    });

    it("rejects malformed emails", () => {
      for (const email of ["", "plain", "user@", "@example.com", "user@"]) {
        const result = signInSchema.safeParse({ email, password: "secret123" });
        expect(result.success, email || "(empty)").toBe(false);
      }
    });

    it("rejects an empty password", () => {
      const result = signInSchema.safeParse({ email: "user@example.com", password: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("signUpSchema", () => {
    it("requires at least 8 characters", () => {
      expect(signUpSchema.safeParse({ email: "u@example.com", password: "1234567" }).success).toBe(
        false,
      );
      expect(signUpSchema.safeParse({ email: "u@example.com", password: "12345678" }).success).toBe(
        true,
      );
    });
  });

  describe("forgotPasswordSchema", () => {
    it("requires a valid email", () => {
      expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
      expect(forgotPasswordSchema.safeParse({ email: "u@example.com" }).success).toBe(true);
    });
  });

  describe("resetPasswordSchema", () => {
    it("accepts matching passwords of sufficient length", () => {
      expect(
        resetPasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "newpassword1" })
          .success,
      ).toBe(true);
    });

    it("rejects mismatched passwords", () => {
      const result = resetPasswordSchema.safeParse({
        password: "newpassword1",
        confirmPassword: "different2",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/do not match/i);
      }
    });

    it("rejects short passwords", () => {
      expect(
        resetPasswordSchema.safeParse({ password: "short", confirmPassword: "short" }).success,
      ).toBe(false);
    });
  });
});
