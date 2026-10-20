#!/usr/bin/env node
/**
 * Worker end-to-end check against an AUTHORIZED staging target.
 *
 * Primary target: a throwaway HTTP server started by this script on
 * 127.0.0.1 (our own staging page — a login form and a dashboard).
 * The full production path runs: job row → policy authorization →
 * claim → Playwright driver (real Chromium) behind the real SSRF
 * network guard → sanitized result + artifact upload to the store.
 * Loopback requires the worker's TEST-ONLY WORKER_ALLOW_LOOPBACK
 * semantics (allowLoopback: true) — exactly what that flag exists for.
 *
 * Optional external target (E2E_EXTERNAL=1): the same path against
 * https://example.com (IANA's public example domain) with the guard in
 * production mode. In locked-down sandboxes this can be blocked by
 * egress policy — the script reports the actual outcome either way.
 *
 * Usage:
 *   npm run worker:build
 *   node workers/playwright/scripts/e2e-staging.mjs
 * Exit code 0 only when the staging run succeeds end to end.
 */
import { createServer } from "node:http";

import { chromium } from "playwright";

import { createPlaywrightDriver } from "../dist/workers/playwright/src/driver.js";
import { startHealthServer, stopHealthServer } from "../dist/workers/playwright/src/health.js";
import { createMetrics } from "../dist/workers/playwright/src/metrics.js";
import { processJob } from "../dist/workers/playwright/src/runner.js";
import { createNetworkGuard } from "../dist/workers/playwright/src/ssrf.js";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function startStagingServer() {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/login") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><body><h1>Staging Sign In</h1><form action="/dashboard" method="get">` +
          `<label>Email <input name="email" placeholder="Email"></label>` +
          `<button type="submit">Sign in</button></form></body></html>`,
      );
    } else if (url.startsWith("/dashboard")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><h1>Dashboard</h1><p>Welcome back</p></body></html>`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** In-memory JobStore with the production store's contract. */
function makeStore(job) {
  const jobs = new Map([[job.id, job]]);
  const uploaded = [];
  return {
    uploaded,
    async listQueued() {
      return [...jobs.values()].filter((j) => j.status === "queued");
    },
    async claim(id, workerId, leaseMs) {
      const j = jobs.get(id);
      if (!j || j.status !== "queued") return null;
      j.status = "running";
      j.claimed_by = workerId;
      j.claimed_at = new Date().toISOString();
      j.lease_expires_at = new Date(Date.now() + leaseMs).toISOString();
      return j;
    },
    async heartbeat(id, workerId, leaseMs) {
      const j = jobs.get(id);
      if (!j) return false;
      j.lease_expires_at = new Date(Date.now() + leaseMs).toISOString();
      return true;
    },
    async update(id, patch) {
      Object.assign(jobs.get(id), patch);
    },
    async getById(id) {
      return jobs.get(id) ?? null;
    },
    async countRunningByWorkspace() {
      return 0;
    },
    async countRecentByWorkspace() {
      return 0;
    },
    async listStaleRunning() {
      return [];
    },
    async workspaceExists(id) {
      return id === WS;
    },
    async projectInWorkspace(projectId, workspaceId) {
      return projectId === PROJECT && workspaceId === WS;
    },
    async isMember(workspaceId, userId) {
      return workspaceId === WS && userId === "user-1";
    },
    async uploadArtifact(path, bytes) {
      uploaded.push({ path, bytes: bytes.length });
    },
  };
}

function makeJob(overrides) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workspace_id: WS,
    project_id: PROJECT,
    run_id: null,
    test_case_id: null,
    idempotency_key: "e2e-key-12345678",
    status: "queued",
    failure_kind: null,
    attempts: 1,
    max_attempts: 2,
    cancel_requested: false,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    result: null,
    error: null,
    created_by: "user-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const config = {
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseServiceRoleKey: "e2e-not-a-real-key",
  workerId: "e2e-worker",
  pollIntervalMs: 100,
  heartbeatIntervalMs: 1_000,
  leaseMs: 60_000,
  jobTimeoutMs: 30_000,
  maxConcurrentPerWorkspace: 2,
  dailyJobLimitPerWorkspace: 50,
  maxScreenshotBytes: 1_000_000,
  maxScreenshotsPerJob: 2,
  maxParallelJobs: 1,
  healthPort: 0,
  shutdownTimeoutMs: 5_000,
  allowLoopback: true,
  chromiumSandbox: false, // this sandbox VM has no user namespaces; production keeps the sandbox ON
};

async function runJob(browser, { plan, allowLoopback }) {
  const guard = createNetworkGuard({ allowLoopback });
  const job = makeJob({ plan });
  const store = makeStore(job);
  const claimed = await store.claim(job.id, config.workerId, config.leaseMs, job.attempts);
  const driver = createPlaywrightDriver(browser, guard, {
    maxScreenshotBytes: config.maxScreenshotBytes,
  });
  try {
    const outcome = await processJob(store, driver, config, claimed);
    const final = await store.getById(job.id);
    return {
      outcome,
      result: final.result,
      uploaded: store.uploaded,
      error: final.error,
      failureKind: final.failure_kind,
      status: final.status,
    };
  } finally {
    await driver.close();
  }
}

async function main() {
  const failures = [];

  // Observability surface: health + metrics from the built worker.
  const metrics = createMetrics();
  const health = startHealthServer(18099, {
    workerId: "e2e-worker",
    metrics,
    isShuttingDown: () => false,
  });
  const healthRes = await fetch("http://127.0.0.1:18099/healthz");
  const healthBody = await healthRes.json();
  console.log(`healthz: ${healthRes.status} ${JSON.stringify(healthBody)}`);
  if (healthRes.status !== 200 || healthBody.status !== "ok") failures.push("healthz not ok");
  const metricsRes = await fetch("http://127.0.0.1:18099/metrics");
  const metricsText = await metricsRes.text();
  console.log(`metrics: ${metricsRes.status} (${metricsText.split("\n")[2] ?? ""})`);
  if (!metricsText.includes("testpilot_worker_jobs_claimed_total"))
    failures.push("metrics missing");
  await stopHealthServer(health);

  const { server, port } = await startStagingServer();
  console.log(`staging target: http://127.0.0.1:${port}/login`);
  const browser = await chromium.launch({ chromiumSandbox: false });
  try {
    const staging = await runJob(browser, {
      allowLoopback: true,
      plan: {
        version: "1",
        name: "Staging login smoke",
        baseUrl: `http://127.0.0.1:${port}`,
        allowedHosts: ["127.0.0.1"],
        steps: [
          { action: "goto", url: "/login" },
          { action: "fill", locator: { by: "label", label: "Email" }, value: "qa@example.com" },
          { action: "click", locator: { by: "role", role: "button", name: "Sign in" } },
          { action: "assertUrl", expected: "/dashboard", match: "contains" },
          {
            action: "assertText",
            locator: { by: "text", text: "Welcome back" },
            text: "Welcome back",
          },
        ],
      },
    });
    console.log(`staging job outcome: ${staging.outcome}`);
    console.log(`staging steps: ${JSON.stringify(staging.result?.steps ?? [])}`);
    console.log(
      `staging job state: status=${staging.status} failure=${staging.failureKind} error=${staging.error}`,
    );
    console.log(`artifacts uploaded: ${JSON.stringify(staging.uploaded)}`);
    if (staging.outcome !== "succeeded") failures.push(`staging outcome ${staging.outcome}`);

    if (process.env.E2E_EXTERNAL === "1") {
      const external = await runJob(browser, {
        allowLoopback: false,
        plan: {
          version: "1",
          name: "Example.com smoke",
          baseUrl: "https://example.com",
          allowedHosts: ["example.com"],
          steps: [
            { action: "goto", url: "/" },
            {
              action: "assertText",
              locator: { by: "text", text: "Example Domain" },
              text: "Example Domain",
            },
          ],
        },
      });
      console.log(`external (example.com) outcome: ${external.outcome}`);
      console.log(`external steps: ${JSON.stringify(external.result?.steps ?? [])}`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`E2E FAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("E2E PASSED: worker executed the staging plan end to end.");
}

main().catch((error) => {
  console.error(`E2E ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
