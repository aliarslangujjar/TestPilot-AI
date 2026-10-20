/** @vitest-environment node */
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "@/workers/playwright/src/config";
import { startHealthServer, stopHealthServer } from "@/workers/playwright/src/health";
import { createMetrics, recordOutcome, renderPrometheus } from "@/workers/playwright/src/metrics";
import type { Server } from "node:http";

const BASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
};

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...BASE_ENV, ...extra } as unknown as NodeJS.ProcessEnv;
}

describe("worker config — deployment knobs", () => {
  it("defaults: 1 lane, health on 8080, 30s shutdown grace", () => {
    const config = loadConfig(env());
    expect(config.maxParallelJobs).toBe(1);
    expect(config.healthPort).toBe(8080);
    expect(config.shutdownTimeoutMs).toBe(30_000);
  });

  it("parses overrides, caps lanes at 8, allows health port 0 (disabled)", () => {
    const config = loadConfig(
      env({
        WORKER_MAX_PARALLEL_JOBS: "99",
        WORKER_HEALTH_PORT: "0",
        WORKER_SHUTDOWN_TIMEOUT_MS: "5000",
      }),
    );
    expect(config.maxParallelJobs).toBe(8);
    expect(config.healthPort).toBe(0);
    expect(config.shutdownTimeoutMs).toBe(5000);
  });

  it("rejects an out-of-range health port", () => {
    expect(() => loadConfig(env({ WORKER_HEALTH_PORT: "70000" }))).toThrow(/WORKER_HEALTH_PORT/);
  });
});

describe("worker metrics", () => {
  it("counts outcomes and renders Prometheus text", () => {
    const metrics = createMetrics(1_000);
    metrics.claimed = 3;
    metrics.inFlight = 1;
    recordOutcome(metrics, "succeeded", 2_000);
    recordOutcome(metrics, "failed", 3_000);
    recordOutcome(metrics, "mystery", 4_000); // unknown → failed bucket
    const text = renderPrometheus(metrics, 61_000);
    expect(text).toContain("testpilot_worker_jobs_claimed_total 3");
    expect(text).toContain('testpilot_worker_jobs_finished_total{outcome="succeeded"} 1');
    expect(text).toContain('testpilot_worker_jobs_finished_total{outcome="failed"} 2');
    expect(text).toContain("testpilot_worker_in_flight 1");
    expect(text).toContain("testpilot_worker_uptime_seconds 60");
    expect(metrics.lastJobFinishedAtMs).toBe(4_000);
  });
});

describe("health server", () => {
  let server: Server | null = null;

  afterEach(async () => {
    await stopHealthServer(server);
    server = null;
  });

  it("serves /healthz and /metrics, 404s the rest, and flips to 503 on shutdown", async () => {
    const metrics = createMetrics();
    let down = false;
    server = startHealthServer(18777, {
      workerId: "worker-test",
      metrics,
      isShuttingDown: () => down,
    });
    expect(server).not.toBeNull();
    await new Promise((resolve) => server!.once("listening", resolve));

    const health = await fetch("http://127.0.0.1:18777/healthz");
    expect(health.status).toBe(200);
    const body = await health.json();
    expect(body).toMatchObject({ status: "ok", workerId: "worker-test", inFlight: 0 });

    const metricsRes = await fetch("http://127.0.0.1:18777/metrics");
    expect(metricsRes.status).toBe(200);
    expect(await metricsRes.text()).toContain("testpilot_worker_jobs_claimed_total");

    const missing = await fetch("http://127.0.0.1:18777/nope");
    expect(missing.status).toBe(404);

    down = true;
    const draining = await fetch("http://127.0.0.1:18777/healthz");
    expect(draining.status).toBe(503);
    expect((await draining.json()).status).toBe("shutting_down");
  });

  it("port 0 disables the server", () => {
    expect(
      startHealthServer(0, {
        workerId: "worker-test",
        metrics: createMetrics(),
        isShuttingDown: () => false,
      }),
    ).toBeNull();
  });
});
