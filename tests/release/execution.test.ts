/** @vitest-environment node */
/**
 * Release-readiness scenario: REAL Playwright execution through the
 * production worker path (processJob → policy → driver → Chromium)
 * against the authorized demo app — the loopback fixture application
 * the project owns. No external sites, no production data.
 *
 * Covers: a full login-flow run, failure evidence (screenshot
 * artifact + per-step results), a step timeout on a hanging page, a
 * job-level timeout, and worker-side cross-workspace denial.
 */
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import { createPlaywrightDriver } from "@/workers/playwright/src/driver";
import { processJob } from "@/workers/playwright/src/runner";
import { createNetworkGuard } from "@/workers/playwright/src/ssrf";
import type { WorkerConfig } from "@/workers/playwright/src/config";

import { makeFakeStore, makeJob, TEST_PROJECT, TEST_WS } from "../worker/fake-store";
import { startTestServer } from "../worker/fixtures";

function hasBrowser(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

function testConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
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
    ...overrides,
  };
}

function demoPlan(port: number, steps: unknown[]): Record<string, unknown> {
  return {
    version: "1",
    name: "Release demo flow",
    baseUrl: `http://127.0.0.1:${port}`,
    allowedHosts: ["127.0.0.1"],
    steps,
  };
}

type StoredJobResult = { steps: { index: number; action: string; ok: boolean }[] };

function resultOf(store: ReturnType<typeof makeFakeStore>, jobId: string): StoredJobResult | null {
  const result = store.jobs.get(jobId)?.result;
  return (result as StoredJobResult | null) ?? null;
}

describe.skipIf(!hasBrowser())("release scenario — real Playwright execution", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  function newDriver() {
    return createPlaywrightDriver(browser, createNetworkGuard({ allowLoopback: true }), {
      maxScreenshotBytes: 1_000_000,
    });
  }

  it("executes the demo-app login flow end to end and stores per-step results", async () => {
    const { port, close } = await startTestServer();
    try {
      const plan = demoPlan(port, [
        { action: "goto", url: "/" },
        { action: "assertText", locator: { by: "role", role: "heading" }, text: "Welcome" },
        { action: "click", locator: { by: "role", role: "link", name: "Sign in" } },
        {
          action: "fill",
          locator: { by: "placeholder", placeholder: "Email" },
          value: "qa@example.com",
        },
        { action: "click", locator: { by: "role", role: "button", name: "Sign in" } },
        { action: "assertUrl", expected: "/dashboard", match: "contains" },
        { action: "assertText", locator: { by: "role", role: "heading" }, text: "Dashboard" },
      ]);
      const job = makeJob({ plan, idempotency_key: "release-success-0001" });
      const store = makeFakeStore([job]);
      const outcome = await processJob(store, newDriver(), testConfig(), job);
      expect(outcome).toBe("succeeded");
      const stored = store.jobs.get(job.id);
      expect(stored?.status).toBe("succeeded");
      expect(resultOf(store, job.id)?.steps).toHaveLength(7);
      expect(resultOf(store, job.id)?.steps.every((s) => s.ok)).toBe(true);
    } finally {
      await close();
    }
  });

  it("captures screenshot evidence and step detail when an assertion fails", async () => {
    const { port, close } = await startTestServer();
    try {
      const plan = demoPlan(port, [
        { action: "goto", url: "/" },
        {
          action: "assertText",
          locator: { by: "role", role: "heading" },
          text: "This heading does not exist",
          timeoutMs: 600,
        },
      ]);
      const job = makeJob({ plan, idempotency_key: "release-evidence-0001", max_attempts: 1 });
      const store = makeFakeStore([job]);
      const outcome = await processJob(store, newDriver(), testConfig(), job);
      expect(outcome).toBe("failed");
      const stored = store.jobs.get(job.id);
      expect(stored?.status).toBe("failed");
      expect(stored?.failure_kind).toBe("assertion");
      expect(resultOf(store, job.id)?.steps).toHaveLength(2);
      expect(resultOf(store, job.id)?.steps[1]?.ok).toBe(false);
      // Evidence: at least one screenshot artifact was uploaded for
      // the failed step, addressed under this job's prefix.
      expect(store.uploaded.length).toBeGreaterThanOrEqual(1);
      expect(store.uploaded[0]?.bytes).toBeGreaterThan(0);
      expect(store.uploaded[0]?.path).toContain(job.id);
    } finally {
      await close();
    }
  });

  it("times out a step against a hanging page instead of hanging the worker", async () => {
    const hangServer: Server = createServer((_req, res) => {
      const t = setTimeout(() => res.end("<html><body>slow</body></html>"), 60_000);
      res.on("close", () => clearTimeout(t));
    });
    await new Promise<void>((resolve) => hangServer.listen(0, "127.0.0.1", resolve));
    const port = (hangServer.address() as { port: number }).port;
    try {
      const plan = demoPlan(port, [{ action: "goto", url: "/hang", timeoutMs: 800 }]);
      const job = makeJob({ plan, idempotency_key: "release-timeout-0001", max_attempts: 1 });
      const store = makeFakeStore([job]);
      const started = Date.now();
      const outcome = await processJob(store, newDriver(), testConfig(), job);
      const elapsed = Date.now() - started;
      expect(outcome).toBe("failed");
      expect(elapsed).toBeLessThan(25_000);
      expect(resultOf(store, job.id)?.steps[0]?.ok).toBe(false);
    } finally {
      hangServer.closeAllConnections();
      await new Promise<void>((resolve) => hangServer.close(() => resolve()));
    }
  }, 30_000);

  it("classifies a job-level timeout as failure_kind=timeout", async () => {
    const { port, close } = await startTestServer();
    try {
      const plan = demoPlan(port, [
        { action: "goto", url: "/" },
        { action: "assertText", locator: { by: "role", role: "heading" }, text: "Welcome" },
      ]);
      const job = makeJob({ plan, idempotency_key: "release-jobtimeout-1", max_attempts: 1 });
      const store = makeFakeStore([job]);
      const outcome = await processJob(store, newDriver(), testConfig({ jobTimeoutMs: 50 }), job);
      expect(outcome).toBe("failed");
      expect(store.jobs.get(job.id)?.failure_kind).toBe("timeout");
    } finally {
      await close();
    }
  });

  it("denies a job for a workspace the worker cannot verify (cross-workspace)", async () => {
    const { port, close } = await startTestServer();
    try {
      const plan = demoPlan(port, [{ action: "goto", url: "/" }]);
      const job = makeJob({
        plan,
        workspace_id: "99999999-9999-4999-8999-999999999999",
        idempotency_key: "release-denied-00001",
      });
      const store = makeFakeStore([job]);
      // The fake store only knows TEST_WS/TEST_PROJECT memberships.
      expect(job.workspace_id).not.toBe(TEST_WS);
      expect(job.project_id).toBe(TEST_PROJECT);
      const outcome = await processJob(store, newDriver(), testConfig(), job);
      expect(outcome).toBe("failed");
      const stored = store.jobs.get(job.id);
      expect(stored?.error).toContain("Unauthorized");
      expect(stored?.result).toBeNull();
      expect(store.uploaded).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
