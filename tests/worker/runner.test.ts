/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

import type { BrowserDriver, DriverResult } from "@/workers/playwright/src/driver";
import { processJob, reapStaleJobs } from "@/workers/playwright/src/runner";
import type { WorkerConfig } from "@/workers/playwright/src/config";

import { makeFakeStore, makeJob } from "./fake-store";

function testConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key",
    workerId: "worker-1",
    pollIntervalMs: 100,
    heartbeatIntervalMs: 30_000,
    leaseMs: 300_000,
    jobTimeoutMs: 5_000,
    maxConcurrentPerWorkspace: 2,
    dailyJobLimitPerWorkspace: 50,
    maxScreenshotBytes: 1_000_000,
    maxScreenshotsPerJob: 2,
    allowLoopback: false,
    chromiumSandbox: true,
    ...overrides,
  };
}

/** Stub driver: scripted step outcomes, optional hooks behavior. */
function stubDriver(script: {
  steps?: DriverResult["steps"];
  throwError?: unknown;
  hang?: boolean;
  onHooks?: (hooks: NonNullable<Parameters<BrowserDriver["run"]>[1]>) => void;
}): BrowserDriver {
  return {
    async run(_plan, hooks = {}) {
      script.onHooks?.(hooks);
      if (script.throwError) throw script.throwError;
      if (script.hang) await new Promise(() => undefined);
      return { steps: script.steps ?? [], cancelled: false, crashed: false };
    },
    async close() {},
  };
}

const okSteps = [
  { index: 0, action: "goto", ok: true, durationMs: 10 },
  { index: 1, action: "assertText", ok: true, durationMs: 5 },
];

describe("processJob", () => {
  it("fails invalid payloads without retry and without touching the driver", async () => {
    const store = makeFakeStore();
    const job = makeJob({ plan: { version: "1", bogus: true }, attempts: 1 });
    store.jobs.set(job.id, job);
    const run = vi.fn();
    const outcome = await processJob(
      store,
      { run: run as never, close: async () => {} },
      testConfig(),
      job,
    );
    expect(outcome).toBe("failed");
    expect(run).not.toHaveBeenCalled();
    expect(store.jobs.get(job.id)?.status).toBe("failed");
    expect(store.jobs.get(job.id)?.error).toContain("Invalid job payload");
  });

  it("fails unauthorized jobs without retry", async () => {
    const store = makeFakeStore();
    store.workspaces.clear();
    const job = makeJob();
    store.jobs.set(job.id, job);
    const outcome = await processJob(store, stubDriver({ steps: okSteps }), testConfig(), job);
    expect(outcome).toBe("failed");
    expect(store.jobs.get(job.id)?.error).toContain("Unauthorized");
  });

  it("defers jobs over the concurrency cap, leaving them queued", async () => {
    const store = makeFakeStore([
      makeJob({ id: "r1", status: "running" }),
      makeJob({ id: "r2", status: "running", idempotency_key: "k2" }),
    ]);
    const job = makeJob({ id: "new-job", idempotency_key: "k3", status: "queued", attempts: 0 });
    store.jobs.set(job.id, job);
    const outcome = await processJob(store, stubDriver({ steps: okSteps }), testConfig(), job);
    expect(outcome).toBe("deferred");
    expect(store.jobs.get(job.id)?.status).toBe("queued");
  });

  it("marks all-ok runs succeeded with sanitized step results", async () => {
    const store = makeFakeStore();
    const job = makeJob();
    store.jobs.set(job.id, job);
    const outcome = await processJob(store, stubDriver({ steps: okSteps }), testConfig(), job);
    expect(outcome).toBe("succeeded");
    const row = store.jobs.get(job.id);
    expect(row?.status).toBe("succeeded");
    expect((row?.result as { steps: unknown[] })?.steps).toHaveLength(2);
  });

  it("fails assertion failures without retry and captures a screenshot artifact", async () => {
    const store = makeFakeStore();
    const job = makeJob();
    store.jobs.set(job.id, job);
    // The real driver reports the failure and offers the screenshot via hook.
    const failingDriver: BrowserDriver = {
      async run(_plan, hooks = {}) {
        await hooks.onStepFailure?.(1, Buffer.from("fake-png-bytes"));
        return {
          steps: [
            { index: 0, action: "goto", ok: true, durationMs: 10 },
            { index: 1, action: "assertText", ok: false, durationMs: 5, error: "text mismatch" },
          ],
          cancelled: false,
          crashed: false,
        };
      },
      async close() {},
    };
    const outcome = await processJob(store, failingDriver, testConfig(), job);
    expect(outcome).toBe("failed");
    const row = store.jobs.get(job.id);
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1); // no retry consumed for deterministic failures
    expect(store.uploaded).toHaveLength(1);
    expect(store.uploaded[0]?.path).toContain(job.id);
  });

  it("honours cancellation requested mid-run", async () => {
    const store = makeFakeStore();
    const job = makeJob();
    store.jobs.set(job.id, job);
    const cancellingDriver: BrowserDriver = {
      async run(_plan, hooks = {}) {
        // First step runs, then the user cancels before the second.
        await store.update(job.id, { cancel_requested: true });
        if (await hooks.shouldCancel?.()) {
          return {
            steps: [{ index: 0, action: "goto", ok: true, durationMs: 10 }],
            cancelled: true,
            crashed: false,
          };
        }
        throw new Error("should have cancelled");
      },
      async close() {},
    };
    const outcome = await processJob(store, cancellingDriver, testConfig(), job);
    expect(outcome).toBe("cancelled");
    expect(store.jobs.get(job.id)?.status).toBe("cancelled");
  });

  it("retries infra crashes while attempts remain, then fails", async () => {
    const store = makeFakeStore();
    const crashing: BrowserDriver = {
      async run() {
        throw new Error("browser disconnected");
      },
      async close() {},
    };

    const job = makeJob({ attempts: 1, max_attempts: 2 });
    store.jobs.set(job.id, job);
    expect(await processJob(store, crashing, testConfig(), job)).toBe("retried");
    const requeued = store.jobs.get(job.id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.claimed_by).toBeNull();

    const job2 = makeJob({ id: "job-2", idempotency_key: "k-job-2", attempts: 2, max_attempts: 2 });
    store.jobs.set(job2.id, job2);
    expect(await processJob(store, crashing, testConfig(), job2)).toBe("failed");
    expect(store.jobs.get(job2.id)?.status).toBe("failed");
    expect(store.jobs.get(job2.id)?.error).toContain("All 2 attempts failed");
  });

  it("treats job timeouts as infra failures (retried)", async () => {
    const store = makeFakeStore();
    const job = makeJob({ attempts: 1, max_attempts: 3 });
    store.jobs.set(job.id, job);
    const outcome = await processJob(
      store,
      stubDriver({ hang: true }),
      testConfig({ jobTimeoutMs: 50 }),
      job,
    );
    expect(outcome).toBe("retried");
    expect(store.jobs.get(job.id)?.status).toBe("queued");
  });

  it("records failure_kind: assertion for step failures, timeout for exhausted timeouts, infra for crashes", async () => {
    const store = makeFakeStore();
    const assertionJob = makeJob({ id: "job-assert", idempotency_key: "k-assert" });
    store.jobs.set(assertionJob.id, assertionJob);
    const failingDriver: BrowserDriver = {
      async run() {
        return {
          steps: [{ index: 0, action: "assertText", ok: false, durationMs: 5 }],
          cancelled: false,
          crashed: false,
        };
      },
      async close() {},
    };
    expect(await processJob(store, failingDriver, testConfig(), assertionJob)).toBe("failed");
    expect(store.jobs.get(assertionJob.id)?.failure_kind).toBe("assertion");

    const timeoutJob = makeJob({
      id: "job-timeout",
      idempotency_key: "k-timeout",
      attempts: 2,
      max_attempts: 2,
    });
    store.jobs.set(timeoutJob.id, timeoutJob);
    expect(
      await processJob(
        store,
        stubDriver({ hang: true }),
        testConfig({ jobTimeoutMs: 50 }),
        timeoutJob,
      ),
    ).toBe("failed");
    expect(store.jobs.get(timeoutJob.id)?.failure_kind).toBe("timeout");

    const crashJob = makeJob({
      id: "job-crash",
      idempotency_key: "k-crash",
      attempts: 2,
      max_attempts: 2,
    });
    store.jobs.set(crashJob.id, crashJob);
    const crashing: BrowserDriver = {
      async run() {
        throw new Error("browser disconnected");
      },
      async close() {},
    };
    expect(await processJob(store, crashing, testConfig(), crashJob)).toBe("failed");
    expect(store.jobs.get(crashJob.id)?.failure_kind).toBe("infra");
  });
});

describe("reapStaleJobs", () => {
  it("requeues stale leases with attempts left, fails exhausted ones", async () => {
    const past = new Date(Date.now() - 600_000).toISOString();
    const staleOpen = makeJob({
      id: "stale-open",
      idempotency_key: "k-open",
      status: "running",
      attempts: 1,
      max_attempts: 3,
      lease_expires_at: past,
    });
    const staleExhausted = makeJob({
      id: "stale-done",
      idempotency_key: "k-done",
      status: "running",
      attempts: 3,
      max_attempts: 3,
      lease_expires_at: past,
    });
    const fresh = makeJob({
      id: "fresh",
      idempotency_key: "k-fresh",
      status: "running",
      lease_expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    const store = makeFakeStore([staleOpen, staleExhausted, fresh]);
    const reaped = await reapStaleJobs(store, new Date().toISOString());
    expect(reaped).toBe(2);
    expect(store.jobs.get("stale-open")?.status).toBe("queued");
    expect(store.jobs.get("stale-open")?.claimed_by).toBeNull();
    expect(store.jobs.get("stale-done")?.status).toBe("failed");
    expect(store.jobs.get("fresh")?.status).toBe("running");
  });
});

describe("claim atomicity", () => {
  it("two workers racing for one job: exactly one wins", async () => {
    const store = makeFakeStore();
    const job = makeJob({ status: "queued", attempts: 0 });
    store.jobs.set(job.id, job);
    const [a, b] = await Promise.all([
      store.claim(job.id, "worker-a", 300_000, 0),
      store.claim(job.id, "worker-b", 300_000, 0),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(store.jobs.get(job.id)?.attempts).toBe(1);
  });
});
