import { z } from "zod";

/**
 * Workspace usage metering (see docs/COST_MODEL.md).
 *
 * Counters are workspace aggregates per monthly period — deliberately
 * no per-user or per-request detail (data minimization). Payments are
 * out of scope; there is only the configurable free plan for now.
 */

export const usageAmountsSchema = z.object({
  aiCalls: z.number().int().min(0),
  browserRuns: z.number().int().min(0),
  executionSeconds: z.number().int().min(0),
  storageBytes: z.number().int().min(0),
});

export type UsageAmounts = z.infer<typeof usageAmountsSchema>;

export const usageLimitsSchema = usageAmountsSchema;

export type UsageLimits = z.infer<typeof usageLimitsSchema>;

export const usageSnapshotSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  limits: usageLimitsSchema,
  usage: usageAmountsSchema,
  history: z.array(
    z.object({
      periodStart: z.string(),
      usage: usageAmountsSchema,
    }),
  ),
});

export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;
