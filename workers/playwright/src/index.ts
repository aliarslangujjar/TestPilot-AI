import { chromium } from "playwright";

import { assertBrowserPin } from "./browser-pin.js";
import { loadConfig } from "./config.js";
import { createPlaywrightDriver } from "./driver.js";
import { startHealthServer, stopHealthServer } from "./health.js";
import { createMetrics, recordOutcome } from "./metrics.js";
import { processJob, reapStaleJobs } from "./runner.js";
import { sanitizeError } from "./sanitize.js";
import { createNetworkGuard } from "./ssrf.js";
import { createSupabaseJobStore, type JobRow } from "./store.js";
import { checkRunLimits } from "./policy.js";

/**
 * Standalone Playwright worker. Polls the browser_jobs queue, claims jobs
 * atomically, executes v1 plans in isolated browser contexts, and writes
 * back sanitized results. Owns no UI and no system of record.
 *
 * Runs WORKER_MAX_PARALLEL_JOBS claim→execute lanes against one shared
 * browser process (a fresh context per job, as always). Shutdown is
 * graceful: SIGTERM/SIGINT stop new claims, in-flight jobs get up to
 * WORKER_SHUTDOWN_TIMEOUT_MS to finish, the health endpoint flips to
 * 503 immediately, and the process exits 0 — or 1 after the grace
 * deadline, in which case unfinished jobs are recovered by lease
 * expiry + reaping (see docs/WORKER_DEPLOYMENT.md).
 */

async function main(): Promise<void> {
  assertBrowserPin();
  const config = loadConfig();
  if (config.allowLoopback) {
    console.warn(
      "WARNING: WORKER_ALLOW_LOOPBACK=1 — loopback SSRF protection is disabled. Test use only.",
    );
  }

  const metrics = createMetrics();
  const store = createSupabaseJobStore(config);
  const guard = createNetworkGuard({ allowLoopback: config.allowLoopback });

  // One browser process per worker; a FRESH context per job (isolation).
  // chromiumSandbox stays on in production: the worker runs non-privileged
  // and the sandbox must not be traded away for container convenience.
  const browser = await chromium.launch({
    chromiumSandbox: config.chromiumSandbox,
    args: [
      // WebRTC/ICE egress bypasses HTTP routing entirely; restrict it
      // to proxied UDP (there is no proxy here, so effectively off).
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  console.log(
    `worker ${config.workerId} started (node ${process.version}, playwright pinned, chromium ${await browser.version()}, lanes ${config.maxParallelJobs})`,
  );

  const reaped = await reapStaleJobs(store, new Date().toISOString());
  if (reaped > 0) console.log(`reaped ${reaped} stale job(s)`);

  let shuttingDown = false;
  let wakeSleepers: () => void = () => {};
  const shutdownSignal = new Promise<void>((resolve) => {
    wakeSleepers = resolve;
  });
  const healthServer = startHealthServer(config.healthPort, {
    workerId: config.workerId,
    metrics,
    isShuttingDown: () => shuttingDown,
  });
  if (healthServer) console.log(`health endpoint on :${config.healthPort} (/healthz, /metrics)`);

  const sleepOrShutdown = (ms: number): Promise<void> =>
    Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), shutdownSignal]);

  let forceTimer: NodeJS.Timeout | null = null;
  const beginShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`received ${signal} — draining (grace ${config.shutdownTimeoutMs}ms)`);
    wakeSleepers();
    forceTimer = setTimeout(() => {
      console.error("shutdown grace elapsed — forcing exit; in-flight jobs will be reaped");
      process.exit(1);
    }, config.shutdownTimeoutMs);
  };
  process.on("SIGTERM", () => beginShutdown("SIGTERM"));
  process.on("SIGINT", () => beginShutdown("SIGINT"));

  async function claimNextAvailable(): Promise<JobRow | null> {
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

  async function lane(): Promise<void> {
    while (!shuttingDown) {
      try {
        metrics.lastPollAtMs = Date.now();
        const job = await claimNextAvailable();
        if (!job) {
          await sleepOrShutdown(config.pollIntervalMs);
          continue;
        }
        metrics.claimed += 1;
        metrics.inFlight += 1;
        const driver = createPlaywrightDriver(browser, guard, {
          maxScreenshotBytes: config.maxScreenshotBytes,
        });
        try {
          const outcome = await processJob(store, driver, config, job);
          recordOutcome(metrics, outcome);
          console.log(`job ${job.id}: ${outcome}`);
        } catch (error) {
          metrics.runnerErrors += 1;
          console.error(`job ${job.id}: runner error: ${sanitizeError(error)}`);
        } finally {
          metrics.inFlight -= 1;
          await driver.close();
        }
      } catch (error) {
        console.error(`worker loop error: ${sanitizeError(error)}`);
        await sleepOrShutdown(config.pollIntervalMs);
      }
    }
  }

  await Promise.all(Array.from({ length: config.maxParallelJobs }, () => lane()));

  if (forceTimer) clearTimeout(forceTimer);
  console.log("shutting down");
  await stopHealthServer(healthServer);
  await browser.close();
}

main().catch((error) => {
  console.error(`worker fatal: ${sanitizeError(error)}`);
  process.exit(1);
});
