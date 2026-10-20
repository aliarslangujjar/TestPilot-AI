import type { Browser, Locator, Page } from "playwright";

import type { BrowserJobStepResult } from "../../../packages/schemas/src/browser-job.js";
import type {
  BrowserLocator,
  BrowserTestPlan,
  BrowserTestStep,
} from "../../../packages/schemas/src/browser-test.js";

import { sanitizeError, sanitizeText } from "./sanitize.js";
import type { NetworkGuard } from "./ssrf.js";

/**
 * Playwright driver: maps v1 spec steps to Playwright calls.
 *
 * Hard rules (enforced here, documented in docs/BROWSER_WORKER.md):
 * - Every job runs in a FRESH browser context (storage/cookies isolated).
 * - No `page.evaluate`, no init scripts, no extra HTTP headers — the
 *   browser never receives job-supplied code or ANY secret material.
 * - Every request passes the network guard (SSRF boundary), including
 *   each redirect hop (Playwright fires the route handler per hop).
 */

const DEFAULT_STEP_TIMEOUT_MS = 15_000;

export interface DriverHooks {
  /** Checked before each step; true stops the run as cancelled. */
  shouldCancel?: () => Promise<boolean>;
  /** Called with a capped PNG screenshot when a step fails. */
  onStepFailure?: (index: number, screenshot: Buffer | null) => Promise<void>;
}

/**
 * Bounded console/network evidence captured during the run. Feeds the
 * failure-analysis evidence bundle; everything here is sanitized and
 * capped (no page content, no secrets, no unbounded growth).
 */
export interface JobDiagnostics {
  consoleErrors: string[];
  networkErrors: string[];
}

export function emptyDiagnostics(): JobDiagnostics {
  return { consoleErrors: [], networkErrors: [] };
}

const MAX_DIAGNOSTIC_ENTRIES = 5;
const MAX_DIAGNOSTIC_LENGTH = 300;

function pushDiagnostic(list: string[], value: string): void {
  if (list.length < MAX_DIAGNOSTIC_ENTRIES && value.length > 0) list.push(value);
}

export interface DriverResult {
  steps: BrowserJobStepResult[];
  cancelled: boolean;
  crashed: boolean;
  diagnostics: JobDiagnostics;
}

export interface BrowserDriver {
  run(plan: BrowserTestPlan, hooks?: DriverHooks): Promise<DriverResult>;
  /** Close the per-job context (the browser process is shared). */
  close(): Promise<void>;
}

function resolveLocator(page: Page, locator: BrowserLocator): Locator {
  switch (locator.by) {
    case "role":
      return locator.name
        ? page.getByRole(locator.role, { name: locator.name })
        : page.getByRole(locator.role);
    case "label":
      return page.getByLabel(locator.label);
    case "placeholder":
      return page.getByPlaceholder(locator.placeholder);
    case "text":
      return page.getByText(locator.text);
    case "testId":
      return page.getByTestId(locator.testId);
  }
}

function resolveUrl(baseUrl: string, target: string): string {
  return new URL(target, baseUrl).toString();
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() <= deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`Condition not met within ${timeoutMs}ms.`);
}

async function executeStep(
  page: Page,
  plan: BrowserTestPlan,
  step: BrowserTestStep,
): Promise<void> {
  const timeout = "timeoutMs" in step && step.timeoutMs ? step.timeoutMs : DEFAULT_STEP_TIMEOUT_MS;
  switch (step.action) {
    case "goto":
      await page.goto(resolveUrl(plan.baseUrl, step.url), {
        timeout,
        waitUntil: "domcontentloaded",
      });
      return;
    case "click":
      await resolveLocator(page, step.locator).click({ timeout });
      return;
    case "fill":
      await resolveLocator(page, step.locator).fill(step.value, { timeout });
      return;
    case "assertText": {
      const locator = resolveLocator(page, step.locator);
      await waitForCondition(async () => {
        const text = (await locator.textContent()) ?? "";
        return step.exact ? text.trim() === step.text.trim() : text.includes(step.text);
      }, timeout);
      return;
    }
    case "assertUrl": {
      const expected = resolveUrl(plan.baseUrl, step.expected);
      await waitForCondition(async () => {
        const current = page.url();
        return step.match === "contains" ? current.includes(step.expected) : current === expected;
      }, timeout);
      return;
    }
    case "assertState": {
      const locator = resolveLocator(page, step.locator);
      switch (step.state) {
        case "visible":
          await locator.waitFor({ state: "visible", timeout });
          return;
        case "hidden":
          await locator.waitFor({ state: "hidden", timeout });
          return;
        case "enabled":
          await waitForCondition(() => locator.isEnabled(), timeout);
          return;
        case "disabled":
          await waitForCondition(async () => !(await locator.isEnabled()), timeout);
          return;
        case "checked":
          await waitForCondition(() => locator.isChecked(), timeout);
          return;
        case "unchecked":
          await waitForCondition(async () => !(await locator.isChecked()), timeout);
          return;
      }
    }
  }
}

export function createPlaywrightDriver(
  browser: Browser,
  guard: NetworkGuard,
  options: { maxScreenshotBytes: number },
): BrowserDriver {
  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;

  return {
    async run(plan: BrowserTestPlan, hooks: DriverHooks = {}): Promise<DriverResult> {
      const steps: BrowserJobStepResult[] = [];
      let crashed = false;

      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        // No extraHTTPHeaders, no storage state, no credentials: the page
        // gets nothing that could leak worker/server secrets.
      });
      await context.route("**/*", async (route) => {
        const allowed = await guard.allowRequest(route.request().url());
        if (allowed) await route.continue();
        else await route.abort("blockedbyclient");
      });

      const page = await context.newPage();

      // Bounded console/network evidence for failure analysis. Errors
      // only (never full console output), capped count and length, and
      // sanitized — the same discipline as step-error sanitization.
      const diagnostics = emptyDiagnostics();
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          pushDiagnostic(
            diagnostics.consoleErrors,
            sanitizeText(msg.text(), MAX_DIAGNOSTIC_LENGTH),
          );
        }
      });
      page.on("pageerror", (err) => {
        pushDiagnostic(
          diagnostics.consoleErrors,
          sanitizeText(err instanceof Error ? err.message : String(err), MAX_DIAGNOSTIC_LENGTH),
        );
      });
      page.on("requestfailed", (req) => {
        const reason = req.failure()?.errorText ?? "request failed";
        pushDiagnostic(
          diagnostics.networkErrors,
          sanitizeText(`${req.method()} ${req.url()} (${reason})`, MAX_DIAGNOSTIC_LENGTH),
        );
      });
      page.on("response", (res) => {
        if (res.status() >= 400) {
          pushDiagnostic(
            diagnostics.networkErrors,
            sanitizeText(
              `${res.status()} ${res.request().method()} ${res.url()}`,
              MAX_DIAGNOSTIC_LENGTH,
            ),
          );
        }
      });

      for (const [index, step] of plan.steps.entries()) {
        if (hooks.shouldCancel && (await hooks.shouldCancel())) {
          return { steps, cancelled: true, crashed: false, diagnostics };
        }
        const started = Date.now();
        try {
          await executeStep(page, plan, step);
          steps.push({
            index,
            action: step.action,
            ok: true,
            durationMs: Date.now() - started,
          });
        } catch (error) {
          steps.push({
            index,
            action: step.action,
            ok: false,
            durationMs: Date.now() - started,
            error: sanitizeError(error),
          });
          if (hooks.onStepFailure) {
            let screenshot: Buffer | null = null;
            try {
              const shot = await page.screenshot({ type: "png" });
              if (shot.length <= options.maxScreenshotBytes) screenshot = shot;
            } catch {
              // Screenshot is best-effort; leave it null.
            }
            await hooks.onStepFailure(index, screenshot);
          }
          if (!browser.isConnected()) crashed = true;
          return { steps, cancelled: false, crashed, diagnostics };
        }
      }

      return { steps, cancelled: false, crashed: false, diagnostics };
    },

    async close(): Promise<void> {
      if (context) {
        await context.close().catch(() => undefined);
        context = null;
      }
    },
  };
}
