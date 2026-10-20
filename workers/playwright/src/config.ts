/**
 * Worker configuration. The ONLY file that reads process env.
 *
 * The service-role key is read here and used only by the Node-side
 * Supabase client (supabase-store.ts). It is never passed to a browser
 * context, never sent to a page, and never logged.
 */

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  workerId: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  leaseMs: number;
  /** Hard cap on a whole job, across all steps. */
  jobTimeoutMs: number;
  /** Run limits, re-checked by the worker before every claim. */
  maxConcurrentPerWorkspace: number;
  dailyJobLimitPerWorkspace: number;
  maxScreenshotBytes: number;
  maxScreenshotsPerJob: number;
  /**
   * TEST-ONLY escape hatch: allow requests to loopback addresses.
   * Never set in production — it disables part of the SSRF boundary.
   */
  allowLoopback: boolean;
  /**
   * Chromium sandbox. On by default; set WORKER_CHROMIUM_SANDBOX=0 only
   * where the sandbox cannot run (e.g. root in a container without
   * userns). Production Docker runs non-root with the sandbox on.
   */
  chromiumSandbox: boolean;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}").`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const supabaseUrl = env.SUPABASE_URL ?? "";
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl) throw new Error("SUPABASE_URL is required.");
  if (!supabaseServiceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    workerId: env.WORKER_ID ?? `worker-${process.pid}`,
    pollIntervalMs: intEnv(env, "WORKER_POLL_INTERVAL_MS", 5_000),
    heartbeatIntervalMs: intEnv(env, "WORKER_HEARTBEAT_INTERVAL_MS", 30_000),
    leaseMs: intEnv(env, "WORKER_LEASE_MS", 300_000),
    jobTimeoutMs: intEnv(env, "WORKER_JOB_TIMEOUT_MS", 120_000),
    maxConcurrentPerWorkspace: intEnv(env, "WORKER_MAX_CONCURRENT_PER_WORKSPACE", 2),
    dailyJobLimitPerWorkspace: intEnv(env, "WORKER_DAILY_JOB_LIMIT", 50),
    maxScreenshotBytes: intEnv(env, "WORKER_MAX_SCREENSHOT_BYTES", 1_000_000),
    maxScreenshotsPerJob: intEnv(env, "WORKER_MAX_SCREENSHOTS_PER_JOB", 2),
    allowLoopback: env.WORKER_ALLOW_LOOPBACK === "1",
    chromiumSandbox: env.WORKER_CHROMIUM_SANDBOX !== "0",
  };
}
