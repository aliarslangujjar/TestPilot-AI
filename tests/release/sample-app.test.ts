/** @vitest-environment node */
/**
 * Beta guard for the shipped sample: the example demo app
 * (examples/demo-app) and its sample browser plan must work together
 * exactly as a new user would run them — the plan file parses under
 * the real spec schema unchanged, and the production worker executes
 * it green against the example server (baseUrl retargeted to the
 * test's ephemeral port; steps untouched).
 */
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import { browserTestPlanSchema } from "@schemas/browser-test";

import { createPlaywrightDriver } from "@/workers/playwright/src/driver";
import { processJob } from "@/workers/playwright/src/runner";
import { createNetworkGuard } from "@/workers/playwright/src/ssrf";
import type { WorkerConfig } from "@/workers/playwright/src/config";

// The shipped example server (plain .mjs; typed via its .d.mts).
import { createDemoAppServer } from "../../examples/demo-app/server.mjs";
import { makeFakeStore, makeJob } from "../worker/fake-store";

const planPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../examples/demo-app/sample-plan.json",
);

function hasBrowser(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

function testConfig(): WorkerConfig {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key",
    workerId: "worker-1",
    pollIntervalMs: 100,
    heartbeatIntervalMs: 30_000,
    leaseMs: 300_000,
    jobTimeoutMs: 30_000,
    maxConcurrentPerWorkspace: 2,
    dailyJobLimitPerWorkspace: 50,
    maxScreenshotBytes: 1_000_000,
    maxScreenshotsPerJob: 2,
    maxParallelJobs: 1,
    healthPort: 0,
    shutdownTimeoutMs: 30_000,
    allowLoopback: true,
    chromiumSandbox: true,
  };
}

describe("beta sample — demo app + sample plan", () => {
  it("the shipped sample-plan.json is valid under the browser-test spec, unchanged", () => {
    const raw: unknown = JSON.parse(readFileSync(planPath, "utf8"));
    const parsed = browserTestPlanSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.baseUrl).toBe("http://127.0.0.1:4321");
      expect(parsed.data.steps).toHaveLength(10);
    }
  });

  describe.skipIf(!hasBrowser())("execution", () => {
    let browser: Browser;
    let server: Server;
    let port = 0;

    beforeAll(async () => {
      browser = await chromium.launch();
      server = createDemoAppServer();
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          port = typeof address === "object" && address !== null ? address.port : 0;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("executes the shipped sample plan green against the example app", async () => {
      const raw: unknown = JSON.parse(readFileSync(planPath, "utf8"));
      const shipped = browserTestPlanSchema.parse(raw);
      const plan = { ...shipped, baseUrl: `http://127.0.0.1:${port}` };

      const job = makeJob({ plan, idempotency_key: "beta-sample-plan-0001" });
      const store = makeFakeStore([job]);
      const driver = createPlaywrightDriver(browser, createNetworkGuard({ allowLoopback: true }), {
        maxScreenshotBytes: 1_000_000,
      });

      const outcome = await processJob(store, driver, testConfig(), job);
      expect(outcome).toBe("succeeded");
      const result = store.jobs.get(job.id)?.result as {
        steps: { ok: boolean }[];
      } | null;
      expect(result?.steps).toHaveLength(10);
      expect(result?.steps.every((s) => s.ok)).toBe(true);
    });
  });
});
