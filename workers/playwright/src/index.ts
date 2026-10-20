import { chromium } from "playwright";

import { assertBrowserPin } from "./browser-pin.js";
import { loadConfig } from "./config.js";
import { createPlaywrightDriver } from "./driver.js";
import { processJob, reapStaleJobs } from "./runner.js";
import { createNetworkGuard } from "./ssrf.js";
import { createSupabaseJobStore } from "./store.js";
import { checkRunLimits } from "./policy.js";

/**
 * Standalone Playwright worker. Polls the browser_jobs queue, claims jobs
 * atomically, executes v1 plans in isolated browser contexts, and writes
 * back sanitized results. Owns no UI and no system of record.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  assertBrowserPin();
  const config = loadConfig();
  if (config.allowLoopback) {
    console.warn(
      "WARNING: WORKER_ALLOW_LOOPBACK=1 — loopback SSRF protection is disabled. Test use only.",
    );
  }

  const store = createSupabaseJobStore(config);
  const guard = createNetworkGuard({ allowLoopback: config.allowLoopback });

  // One browser process per worker; a FRESH context per job (isolation).
  // chromiumSandbox stays on in production: the worker runs non-privileged
  // and the sandbox must not be traded away for container convenience.
  const browser = await chromium.launch({ chromiumSandbox: config.chromiumSandbox });
  console.log(
    `worker ${config.workerId} started (playwright pinned, chromium ${await browser.version()})`,
  );

  const reaped = await reapStaleJobs(store, new Date().toISOString());
  if (reaped > 0) console.log(`reaped ${reaped} stale job(s)`);

  let shuttingDown = false;
  const shutdown = () => {
    shuttingDown = true;
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (!shuttingDown) {
    try {
      const job = await claimNextAvailable();
      if (!job) {
        await sleep(config.pollIntervalMs);
        continue;
      }
      const driver = createPlaywrightDriver(browser, guard, {
        maxScreenshotBytes: config.maxScreenshotBytes,
      });
      try {
        const outcome = await processJob(store, driver, config, job);
        console.log(`job ${job.id}: ${outcome}`);
      } catch (error) {
        console.error(
          `job ${job.id}: runner error: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await driver.close();
      }
    } catch (error) {
      console.error(`worker loop error: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(config.pollIntervalMs);
    }
  }

  console.log("shutting down");
  await browser.close();

  async function claimNextAvailable() {
    const candidates = await store.listQueued(20);
    for (const candidate of candidates) {
      const limits = await checkRunLimits(store, candidate, {
        maxConcurrentPerWorkspace: config.maxConcurrentPerWorkspace,
        dailyJobLimitPerWorkspace: config.dailyJobLimitPerWorkspace,
      });
      if (!limits.ok) continue; // deferred: leave queued for a later pass
      const claimed = await store.claim(
        candidate.id,
        config.workerId,
        config.leaseMs,
        candidate.attempts,
      );
      if (claimed) return claimed; // atomic win; null = another worker won
    }
    return null;
  }
}

main().catch((error) => {
  console.error(`worker fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
