import { createRequire } from "node:module";

/**
 * Pinned Playwright version. The worker refuses to start on any other
 * version: browser automation behavior (and the bundled Chromium build)
 * is version-sensitive, so an unpinned upgrade is a breaking change.
 * A unit test asserts this matches package.json's `playwright` entry.
 */
export const PINNED_PLAYWRIGHT_VERSION = "1.64.1";

export function installedPlaywrightVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("playwright/package.json") as { version: string };
  return pkg.version;
}

export function assertBrowserPin(): void {
  const installed = installedPlaywrightVersion();
  if (installed !== PINNED_PLAYWRIGHT_VERSION) {
    throw new Error(
      `Playwright version mismatch: pinned ${PINNED_PLAYWRIGHT_VERSION}, installed ${installed}. ` +
        "Refusing to start — upgrade the pin deliberately (docs/BROWSER_WORKER.md).",
    );
  }
}
