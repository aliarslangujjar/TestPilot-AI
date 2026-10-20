import { createServer, type Server } from "node:http";

import { renderPrometheus, type WorkerMetrics } from "./metrics.js";

/**
 * Health + metrics HTTP surface for the worker.
 *
 *   GET /healthz  → 200 { status: "ok", ... } while running;
 *                   503 { status: "shutting_down" } during shutdown, so
 *                   orchestrators stop routing/considering the worker
 *                   before it exits.
 *   GET /metrics  → Prometheus text (counters from metrics.ts).
 *
 * Operational data only: no job payloads, no URLs, no credentials, no
 * workspace ids. Bind it to the container/host network only — never
 * publish it to the public internet (see docs/WORKER_DEPLOYMENT.md).
 */

export interface HealthState {
  workerId: string;
  metrics: WorkerMetrics;
  isShuttingDown: () => boolean;
}

export function startHealthServer(port: number, state: HealthState): Server | null {
  if (port <= 0) return null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      const down = state.isShuttingDown();
      const body = {
        status: down ? "shutting_down" : "ok",
        workerId: state.workerId,
        startedAt: new Date(state.metrics.startedAtMs).toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((Date.now() - state.metrics.startedAtMs) / 1000)),
        inFlight: state.metrics.inFlight,
        lastPollAt: state.metrics.lastPollAtMs
          ? new Date(state.metrics.lastPollAtMs).toISOString()
          : null,
        lastJobFinishedAt: state.metrics.lastJobFinishedAtMs
          ? new Date(state.metrics.lastJobFinishedAtMs).toISOString()
          : null,
      };
      res.writeHead(down ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.method === "GET" && url.pathname === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(renderPrometheus(state.metrics));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, "0.0.0.0");
  return server;
}

export function stopHealthServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
