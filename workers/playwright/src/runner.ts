import { parseBrowserTestPlan } from "../../../packages/schemas/src/browser-test.js";
import type { BrowserJobResult } from "../../../packages/schemas/src/browser-job.js";

import type { WorkerConfig } from "./config.js";
import type { BrowserDriver } from "./driver.js";
import { authorizeJob, checkRunLimits } from "./policy.js";
import { sanitizeError } from "./sanitize.js";
import type { JobRow, JobStore } from "./store.js";

/**
 * Job orchestration: validate → authorize → limits → execute → report.
 *
 * Failure taxonomy (decides retry vs. fail vs. defer):
 * - Invalid payload / unauthorized: FAILED, no retry (deterministic).
 * - Over run limits: DEFERRED — left queued for a later pass.
 * - Step assertion failure: FAILED, no retry (deterministic outcome).
 * - Cancel requested: CANCELLED.
 * - Driver threw / browser crashed / job timeout: INFRA failure —
 *   retried while attempts < maxAttempts, else FAILED.
 */

export type ProcessOutcome = "succeeded" | "failed" | "cancelled" | "deferred" | "retried";

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function releaseClaimPatch(): Partial<JobRow> {
  return {
    status: "queued",
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
  };
}

export async function processJob(
  store: JobStore,
  driver: BrowserDriver,
  config: WorkerConfig,
  job: JobRow,
): Promise<ProcessOutcome> {
  const startedAt = new Date().toISOString();

  // 1. Payload validation (worker-side, defense in depth).
  const parsed = parseBrowserTestPlan(job.plan);
  if (!parsed.ok) {
    await store.update(job.id, {
      status: "failed",
      error: `Invalid job payload: ${parsed.errors[0] ?? "validation failed"}`,
    });
    return "failed";
  }

  // 2. Workspace authorization.
  const auth = await authorizeJob(store, job);
  if (!auth.ok) {
    await store.update(job.id, {
      status: "failed",
      error: `Unauthorized: ${auth.reason}.`,
    });
    return "failed";
  }

  // 3. Run limits — defer, don't fail.
  const limits = await checkRunLimits(store, job, {
    maxConcurrentPerWorkspace: config.maxConcurrentPerWorkspace,
    dailyJobLimitPerWorkspace: config.dailyJobLimitPerWorkspace,
  });
  if (!limits.ok) {
    return "deferred";
  }

  // 4. Execute with cancellation checks, heartbeats, and a hard job timeout.
  const artifacts: string[] = [];
  let screenshotsTaken = 0;
  const heartbeat = setInterval(() => {
    void store.heartbeat(job.id, config.workerId, config.leaseMs).catch(() => undefined);
  }, config.heartbeatIntervalMs);
  // Don't keep the process alive for heartbeats alone.
  heartbeat.unref?.();

  const shouldCancel = async (): Promise<boolean> => {
    const fresh = await store.getById(job.id).catch(() => null);
    return fresh?.cancel_requested === true;
  };

  try {
    const driverResult = await withTimeout(
      driver.run(parsed.plan, {
        shouldCancel,
        onStepFailure: async (index, screenshot) => {
          if (!screenshot || screenshotsTaken >= config.maxScreenshotsPerJob) return;
          screenshotsTaken += 1;
          const path = `${job.workspace_id}/${job.id}/step-${index}.png`;
          try {
            await store.uploadArtifact(path, screenshot);
            artifacts.push(path);
          } catch {
            // Artifact upload is best-effort; never fails the job.
          }
        },
      }),
      config.jobTimeoutMs,
      "Job",
    );

    const finishedAt = new Date().toISOString();
    const result: BrowserJobResult = {
      status: driverResult.cancelled
        ? "cancelled"
        : driverResult.steps.every((s) => s.ok)
          ? "succeeded"
          : "failed",
      steps: driverResult.steps,
      artifacts,
      startedAt,
      finishedAt,
    };

    if (driverResult.cancelled) {
      await store.update(job.id, { status: "cancelled", result: result as never });
      return "cancelled";
    }

    if (driverResult.crashed) {
      return await handleInfraFailure(store, job, `Browser crashed during execution.`, result);
    }

    if (result.status === "failed") {
      await store.update(job.id, {
        status: "failed",
        result: result as never,
        error: "A test step failed.",
      });
      return "failed";
    }

    await store.update(job.id, { status: "succeeded", result: result as never });
    return "succeeded";
  } catch (error) {
    // Driver threw (or the job timeout fired): infrastructure failure.
    const partial: BrowserJobResult = {
      status: "failed",
      steps: [],
      artifacts,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    return await handleInfraFailure(store, job, sanitizeError(error), partial);
  } finally {
    clearInterval(heartbeat);
  }
}

async function handleInfraFailure(
  store: JobStore,
  job: JobRow,
  message: string,
  partial: BrowserJobResult,
): Promise<ProcessOutcome> {
  if (job.attempts < job.max_attempts) {
    // Attempts were incremented at claim time; requeue for another try.
    await store.update(job.id, {
      ...releaseClaimPatch(),
      error: `Attempt ${job.attempts}/${job.max_attempts} failed (infra): ${message}`,
    });
    return "retried";
  }
  await store.update(job.id, {
    status: "failed",
    result: partial as never,
    error: `All ${job.max_attempts} attempts failed. Last error: ${message}`,
  });
  return "failed";
}

/**
 * Recover jobs orphaned by crashed workers: stale leases go back to
 * `queued` (or `failed` when attempts are exhausted).
 */
export async function reapStaleJobs(store: JobStore, nowIso: string): Promise<number> {
  const stale = await store.listStaleRunning(nowIso);
  let reaped = 0;
  for (const job of stale) {
    if (job.attempts >= job.max_attempts) {
      await store.update(job.id, {
        status: "failed",
        error: "Worker lost (stale lease) and attempts are exhausted.",
      });
    } else {
      await store.update(job.id, {
        ...releaseClaimPatch(),
        error: "Worker lost (stale lease); requeued.",
      });
    }
    reaped += 1;
  }
  return reaped;
}
