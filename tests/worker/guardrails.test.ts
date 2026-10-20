/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sanitizeError, sanitizeText } from "@/workers/playwright/src/sanitize";
import {
  installedPlaywrightVersion,
  PINNED_PLAYWRIGHT_VERSION,
} from "@/workers/playwright/src/browser-pin";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("sanitize", () => {
  it("strips ANSI codes and keeps the first line only", () => {
    const message =
      "\u001b[31mError: text mismatch\u001b[0m\n    at Object.foo (/app/worker.js:10:5)\n    at bar";
    expect(sanitizeError(message)).toBe("Error: text mismatch");
  });

  it("truncates long messages", () => {
    expect(sanitizeError("x".repeat(1000))).toHaveLength(500);
  });

  it("handles non-string input", () => {
    expect(sanitizeError(null)).toBe("Step failed.");
    expect(sanitizeError(undefined)).toBe("Step failed.");
    expect(sanitizeError(new Error("boom"))).toBe("boom");
  });

  it("sanitizes free text without newlines", () => {
    expect(sanitizeText("  hello\u0007world  ")).toBe("helloworld");
  });
});

describe("browser pin", () => {
  it("matches the pinned version in package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf-8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["playwright"]).toBe(PINNED_PLAYWRIGHT_VERSION);
    expect(installedPlaywrightVersion()).toBe(PINNED_PLAYWRIGHT_VERSION);
  });
});

describe("driver source guarantees", () => {
  it("never calls page.evaluate or installs init scripts", () => {
    const source = readFileSync(resolve(rootDir, "workers/playwright/src/driver.ts"), "utf-8");
    expect(source).not.toContain(".evaluate(");
    expect(source).not.toContain("addInitScript");
    // "extraHTTPHeaders:" with a colon = actual option usage (a bare
    // mention in a comment documenting the guarantee is fine).
    expect(source).not.toContain("extraHTTPHeaders:");
  });

  it("never references the service-role key", () => {
    for (const file of ["driver.ts", "ssrf.ts", "sanitize.ts", "browser-pin.ts"]) {
      const source = readFileSync(resolve(rootDir, `workers/playwright/src/${file}`), "utf-8");
      expect(source).not.toContain("SERVICE_ROLE");
    }
  });
});
