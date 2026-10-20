/** @vitest-environment node */
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import { parseBrowserTestPlan, type BrowserTestPlan } from "@schemas/browser-test";

import { createPlaywrightDriver } from "@/workers/playwright/src/driver";
import { createNetworkGuard } from "@/workers/playwright/src/ssrf";

import { startTestServer } from "./fixtures";

function hasBrowser(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

function planFor(port: number, steps: unknown[]) {
  const parsed = parseBrowserTestPlan({
    version: "1",
    name: "integration",
    baseUrl: `http://127.0.0.1:${port}`,
    allowedHosts: ["127.0.0.1"],
    steps,
  });
  if (!parsed.ok) throw new Error(`fixture plan invalid: ${parsed.errors.join("; ")}`);
  return parsed.plan;
}

// Skipped where no browser is installed (e.g. minimal CI); the pinned
// browser is a production dependency, installed via `npx playwright install`.
describe.skipIf(!hasBrowser())("playwright driver (integration)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("runs goto, fill, click, and all three assertions end to end", async () => {
    const { port, close } = await startTestServer();
    try {
      const driver = createPlaywrightDriver(browser, createNetworkGuard({ allowLoopback: true }), {
        maxScreenshotBytes: 1_000_000,
      });
      const plan = planFor(port, [
        { action: "goto", url: "/" },
        { action: "assertText", locator: { by: "role", role: "heading" }, text: "Welcome" },
        { action: "click", locator: { by: "role", role: "link", name: "Sign in" } },
        { action: "assertUrl", expected: "/login", match: "contains" },
        {
          action: "fill",
          locator: { by: "placeholder", placeholder: "Email" },
          value: "qa@example.com",
        },
        { action: "click", locator: { by: "role", role: "button", name: "Sign in" } },
        { action: "assertUrl", expected: "/dashboard", match: "contains" },
        {
          action: "assertState",
          locator: { by: "role", role: "button", name: "Sign out" },
          state: "visible",
        },
      ]);
      const result = await driver.run(plan);
      await driver.close();
      expect(result.cancelled).toBe(false);
      expect(result.crashed).toBe(false);
      expect(result.steps).toHaveLength(8);
      expect(result.steps.every((s) => s.ok)).toBe(true);
    } finally {
      await close();
    }
  });

  it("enforces allowedHosts at RUNTIME, not just at parse time (audit addendum)", async () => {
    const { port, close } = await startTestServer();
    try {
      const driver = createPlaywrightDriver(browser, createNetworkGuard({ allowLoopback: true }), {
        maxScreenshotBytes: 1_000_000,
      });
      // Hand-built plan (bypasses parse-time validation on purpose):
      // the goto targets "localhost" while only "127.0.0.1" is
      // allowlisted. The SSRF guard alone would ALLOW this (loopback
      // test flag) — the driver's host check is what must block it.
      const plan: BrowserTestPlan = {
        version: "1",
        name: "runtime-allowlist",
        description: "",
        baseUrl: `http://127.0.0.1:${port}`,
        allowedHosts: ["127.0.0.1"],
        steps: [{ action: "goto", url: `http://localhost:${port}/login` }],
      };
      const result = await driver.run(plan);
      await driver.close();
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.ok).toBe(false);
    } finally {
      await close();
    }
  });

  it("reports assertion failures per step without crashing the run", async () => {
    const { port, close } = await startTestServer();
    try {
      const driver = createPlaywrightDriver(browser, createNetworkGuard({ allowLoopback: true }), {
        maxScreenshotBytes: 1_000_000,
      });
      const plan = planFor(port, [
        { action: "goto", url: "/" },
        {
          action: "assertText",
          locator: { by: "role", role: "heading" },
          text: "This text is not on the page",
          timeoutMs: 500,
        },
      ]);
      const result = await driver.run(plan);
      await driver.close();
      expect(result.steps[0]?.ok).toBe(true);
      expect(result.steps[1]?.ok).toBe(false);
      expect(result.steps[1]?.error).toBeTruthy();
    } finally {
      await close();
    }
  });

  it("aborts a redirect hop to a metadata endpoint (redirect revalidation)", async () => {
    const { port, close } = await startTestServer();
    try {
      const driver = createPlaywrightDriver(browser, createNetworkGuard({ allowLoopback: true }), {
        maxScreenshotBytes: 1_000_000,
      });
      const plan = planFor(port, [{ action: "goto", url: "/redirect-evil", timeoutMs: 5000 }]);
      const result = await driver.run(plan);
      await driver.close();
      // The redirect target (169.254.169.254) is link-local: the hop is
      // aborted, so navigation fails instead of reaching the metadata IP.
      expect(result.steps[0]?.ok).toBe(false);
    } finally {
      await close();
    }
  });

  it("blocks loopback destinations without the test-only flag", async () => {
    const { port, close } = await startTestServer();
    try {
      const driver = createPlaywrightDriver(browser, createNetworkGuard(), {
        maxScreenshotBytes: 1_000_000,
      });
      const plan = planFor(port, [{ action: "goto", url: "/", timeoutMs: 5000 }]);
      const result = await driver.run(plan);
      await driver.close();
      expect(result.steps[0]?.ok).toBe(false);
    } finally {
      await close();
    }
  });

  it("captures bounded console and network diagnostics for failure analysis", async () => {
    const { port, close } = await startTestServer();
    try {
      const driver = createPlaywrightDriver(browser, createNetworkGuard({ allowLoopback: true }), {
        maxScreenshotBytes: 1_000_000,
      });
      const plan = planFor(port, [
        { action: "goto", url: "/noisy" },
        {
          action: "assertText",
          locator: { by: "role", role: "heading" },
          text: "does not exist",
          timeoutMs: 500,
        },
      ]);
      const result = await driver.run(plan);
      await driver.close();

      // The assertion fails, but the diagnostics gathered during
      // navigation survive in the result.
      expect(result.steps[1]?.ok).toBe(false);
      expect(
        result.diagnostics.consoleErrors.some((e) => e.includes("widget failed to load")),
      ).toBe(true);
      expect(result.diagnostics.networkErrors.some((e) => e.includes("404"))).toBe(true);
      expect(result.diagnostics.networkErrors.some((e) => e.includes("missing.js"))).toBe(true);
      expect(result.diagnostics.consoleErrors.length).toBeLessThanOrEqual(5);
      expect(result.diagnostics.networkErrors.length).toBeLessThanOrEqual(5);
    } finally {
      await close();
    }
  });
});
