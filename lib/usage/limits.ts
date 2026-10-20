import type { UsageAmounts, UsageLimits } from "@schemas/usage";

/**
 * Free-plan quota configuration (docs/COST_MODEL.md).
 *
 * Payments are deferred — the free plan is currently the only plan.
 * Limits are deployment-configurable via env overrides; anything
 * missing or invalid falls back to the defaults below.
 */

export const FREE_LIMIT_DEFAULTS: UsageLimits = {
  aiCalls: 200,
  browserRuns: 100,
  executionSeconds: 3_600,
  storageBytes: 500 * 1024 * 1024, // 500 MiB
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getUsageLimits(env: Record<string, string | undefined> = process.env): UsageLimits {
  return {
    aiCalls: parsePositiveInt(env.USAGE_FREE_AI_CALLS, FREE_LIMIT_DEFAULTS.aiCalls),
    browserRuns: parsePositiveInt(env.USAGE_FREE_BROWSER_RUNS, FREE_LIMIT_DEFAULTS.browserRuns),
    executionSeconds: parsePositiveInt(
      env.USAGE_FREE_EXECUTION_SECONDS,
      FREE_LIMIT_DEFAULTS.executionSeconds,
    ),
    storageBytes: parsePositiveInt(env.USAGE_FREE_STORAGE_BYTES, FREE_LIMIT_DEFAULTS.storageBytes),
  };
}

export const EMPTY_USAGE: UsageAmounts = {
  aiCalls: 0,
  browserRuns: 0,
  executionSeconds: 0,
  storageBytes: 0,
};

/** Monthly periods, UTC. periodStart is an ISO date (YYYY-MM-01). */
export function periodStartFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function currentPeriodStart(now = new Date()): string {
  return periodStartFor(now);
}

/** Exclusive end of the period that starts at periodStart (ISO date). */
export function periodEndFor(periodStart: string): string {
  const d = new Date(`${periodStart}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return periodStartFor(d);
}

/** True when adding `amount` to `used` would exceed `limit`. */
export function wouldExceed(used: number, amount: number, limit: number): boolean {
  return amount > 0 && used + amount > limit;
}

/** The resource whose quota a failed reservation hit, for error copy. */
export function firstExceededResource(
  usage: UsageAmounts,
  amounts: Partial<UsageAmounts>,
  limits: UsageLimits,
): keyof UsageAmounts | null {
  const keys: Array<keyof UsageAmounts> = [
    "aiCalls",
    "browserRuns",
    "executionSeconds",
    "storageBytes",
  ];
  for (const key of keys) {
    const amount = amounts[key] ?? 0;
    if (wouldExceed(usage[key], amount, limits[key])) return key;
  }
  return null;
}

export const RESOURCE_LABELS: Record<keyof UsageAmounts, string> = {
  aiCalls: "AI calls",
  browserRuns: "Browser runs",
  executionSeconds: "Execution time",
  storageBytes: "Artifact storage",
};
