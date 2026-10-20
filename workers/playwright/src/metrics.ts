/**
 * In-memory worker metrics. Counters only — no job payloads, no URLs,
 * no workspace-identifying data beyond counts (data minimization,
 * same rule as the app's usage metering). Rendered as Prometheus text
 * on the health server's /metrics endpoint.
 */

export type JobOutcome = "succeeded" | "failed" | "cancelled" | "retried" | "deferred";

export interface WorkerMetrics {
  startedAtMs: number;
  claimed: number;
  outcomes: Record<JobOutcome, number>;
  runnerErrors: number;
  inFlight: number;
  lastPollAtMs: number | null;
  lastJobFinishedAtMs: number | null;
}

export function createMetrics(now = Date.now()): WorkerMetrics {
  return {
    startedAtMs: now,
    claimed: 0,
    outcomes: { succeeded: 0, failed: 0, cancelled: 0, retried: 0, deferred: 0 },
    runnerErrors: 0,
    inFlight: 0,
    lastPollAtMs: null,
    lastJobFinishedAtMs: null,
  };
}

export function recordOutcome(metrics: WorkerMetrics, outcome: string, now = Date.now()): void {
  if (
    outcome === "succeeded" ||
    outcome === "failed" ||
    outcome === "cancelled" ||
    outcome === "retried" ||
    outcome === "deferred"
  ) {
    metrics.outcomes[outcome] += 1;
  } else {
    metrics.outcomes.failed += 1;
  }
  metrics.lastJobFinishedAtMs = now;
}

export function renderPrometheus(metrics: WorkerMetrics, now = Date.now()): string {
  const lines = [
    "# HELP testpilot_worker_jobs_claimed_total Jobs claimed by this worker.",
    "# TYPE testpilot_worker_jobs_claimed_total counter",
    `testpilot_worker_jobs_claimed_total ${metrics.claimed}`,
    "# HELP testpilot_worker_jobs_finished_total Jobs finished, by outcome.",
    "# TYPE testpilot_worker_jobs_finished_total counter",
  ];
  for (const [outcome, count] of Object.entries(metrics.outcomes)) {
    lines.push(`testpilot_worker_jobs_finished_total{outcome="${outcome}"} ${count}`);
  }
  lines.push(
    "# HELP testpilot_worker_runner_errors_total Uncaught runner errors.",
    "# TYPE testpilot_worker_runner_errors_total counter",
    `testpilot_worker_runner_errors_total ${metrics.runnerErrors}`,
    "# HELP testpilot_worker_in_flight Jobs currently executing.",
    "# TYPE testpilot_worker_in_flight gauge",
    `testpilot_worker_in_flight ${metrics.inFlight}`,
    "# HELP testpilot_worker_uptime_seconds Seconds since the worker started.",
    "# TYPE testpilot_worker_uptime_seconds gauge",
    `testpilot_worker_uptime_seconds ${Math.max(0, Math.floor((now - metrics.startedAtMs) / 1000))}`,
  );
  return `${lines.join("\n")}\n`;
}
