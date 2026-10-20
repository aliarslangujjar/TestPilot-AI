/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  BROWSER_TEST_SPEC_VERSION,
  browserTestPlanSchema,
  parseBrowserTestPlan,
  type BrowserTestPlan,
} from "@schemas/browser-test";

function validPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: BROWSER_TEST_SPEC_VERSION,
    name: "Login flow",
    description: "Happy-path sign in.",
    baseUrl: "https://app.example.com",
    allowedHosts: ["app.example.com"],
    steps: [
      { action: "goto", url: "/login" },
      { action: "fill", locator: { by: "label", label: "Email" }, value: "qa@example.com" },
      { action: "fill", locator: { by: "label", label: "Password" }, value: "secret" },
      { action: "click", locator: { by: "role", role: "button", name: "Sign in" } },
      { action: "assertUrl", expected: "/dashboard", match: "contains" },
      {
        action: "assertText",
        locator: { by: "role", role: "heading", name: "Dashboard" },
        text: "Welcome back",
      },
      {
        action: "assertState",
        locator: { by: "role", role: "button", name: "Sign out" },
        state: "visible",
      },
    ],
    ...overrides,
  };
}

describe("browser-test spec", () => {
  it("accepts a valid plan covering every action and locator kind", () => {
    const result = parseBrowserTestPlan(
      validPlan({
        steps: [
          { action: "goto", url: "https://app.example.com/login" },
          { action: "click", locator: { by: "text", text: "Sign in" } },
          { action: "click", locator: { by: "testId", testId: "submit" } },
          { action: "fill", locator: { by: "placeholder", placeholder: "Email" }, value: "a@b.c" },
          {
            action: "fill",
            locator: { by: "role", role: "textbox", name: "Email" },
            value: "a@b.c",
          },
          { action: "assertText", locator: { by: "label", label: "Status" }, text: "Saved" },
          { action: "assertUrl", expected: "https://app.example.com/dashboard" },
          {
            action: "assertState",
            locator: { by: "role", role: "checkbox" },
            state: "checked",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown action", () => {
    const result = parseBrowserTestPlan(
      validPlan({ steps: [{ action: "evaluate", script: "alert(1)" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a smuggled script key on a known action", () => {
    const result = parseBrowserTestPlan(
      validPlan({
        steps: [{ action: "click", locator: { by: "role", role: "button" }, script: "alert(1)" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/unrecognized|invalid/i);
    }
  });

  it("rejects an unknown locator strategy", () => {
    const result = parseBrowserTestPlan(
      validPlan({
        steps: [{ action: "click", locator: { by: "css", selector: "#submit" } }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown plan-level option", () => {
    const result = parseBrowserTestPlan(validPlan({ retries: 3 }));
    expect(result.ok).toBe(false);
  });

  it("rejects navigation outside the allowlist", () => {
    const result = parseBrowserTestPlan(
      validPlan({ steps: [{ action: "goto", url: "https://evil.example.net/phish" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("not allowlisted");
    }
  });

  it("rejects a baseUrl whose host is not allowlisted", () => {
    const result = parseBrowserTestPlan(
      validPlan({ baseUrl: "https://other.example.com", allowedHosts: ["app.example.com"] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a relative goto target that is not a path", () => {
    const result = parseBrowserTestPlan(
      validPlan({ steps: [{ action: "goto", url: "dashboard" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects oversized plans", () => {
    const steps = Array.from({ length: 51 }, (_, i) => ({
      action: "click",
      locator: { by: "testId", testId: `btn-${i}` },
    }));
    const result = parseBrowserTestPlan(validPlan({ steps }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("At most 50 steps");
    }
  });

  it("rejects oversized text fields", () => {
    const result = parseBrowserTestPlan(validPlan({ name: "x".repeat(201) }));
    expect(result.ok).toBe(false);
    const fillTooLong = parseBrowserTestPlan(
      validPlan({
        steps: [
          { action: "fill", locator: { by: "label", label: "Bio" }, value: "x".repeat(2001) },
        ],
      }),
    );
    expect(fillTooLong.ok).toBe(false);
  });

  it("rejects the wrong spec version and a missing version", () => {
    expect(parseBrowserTestPlan(validPlan({ version: "2" })).ok).toBe(false);
    const noVersion = validPlan();
    delete noVersion.version;
    expect(parseBrowserTestPlan(noVersion).ok).toBe(false);
  });

  it("rejects an empty step list and malformed steps", () => {
    expect(parseBrowserTestPlan(validPlan({ steps: [] })).ok).toBe(false);
    expect(parseBrowserTestPlan(validPlan({ steps: "click" })).ok).toBe(false);
    expect(parseBrowserTestPlan("not an object").ok).toBe(false);
  });

  it("rejects out-of-range timeouts", () => {
    const tooBig = parseBrowserTestPlan(
      validPlan({
        steps: [{ action: "goto", url: "/login", timeoutMs: 60_000 }],
      }),
    );
    expect(tooBig.ok).toBe(false);
  });

  it("schema type parses to the declared TypeScript type", () => {
    const parsed = browserTestPlanSchema.safeParse(validPlan());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const plan: BrowserTestPlan = parsed.data;
      expect(plan.version).toBe("1");
      expect(plan.steps).toHaveLength(7);
    }
  });
});

describe("browser-test spec — audit addendum (scheme & allowlist integrity)", () => {
  it("rejects non-http(s) baseUrl schemes (file:, javascript:, data:)", () => {
    for (const baseUrl of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi"]) {
      const result = parseBrowserTestPlan(
        validPlan({ baseUrl, allowedHosts: ["app.example.com"] }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a protocol-relative goto (would bypass the host check)", () => {
    const result = parseBrowserTestPlan(
      validPlan({ steps: [{ action: "goto", url: "//evil.example.com/phish" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/Protocol-relative/);
  });

  it("still accepts an allowlisted absolute goto", () => {
    const result = parseBrowserTestPlan(
      validPlan({ steps: [{ action: "goto", url: "https://app.example.com/login" }] }),
    );
    expect(result.ok).toBe(true);
  });
});
