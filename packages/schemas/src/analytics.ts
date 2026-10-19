import { z } from "zod";

/** Shared analytics validation. */

export const analyticsRangeSchema = z.coerce
  .number()
  .int()
  .refine((v) => [7, 15, 30].includes(v), {
    message: "Range must be 7, 15, or 30 days.",
  });

export type AnalyticsRange = 7 | 15 | 30;

export const dailyPointSchema = z.object({
  date: z.string(),
  label: z.string(),
  pass: z.number(),
  fail: z.number(),
  blocked: z.number(),
  skipped: z.number(),
  total: z.number(),
  passRate: z.number().nullable(),
});

export type DailyPoint = z.infer<typeof dailyPointSchema>;

export const analyticsTotalsSchema = z.object({
  projects: z.number(),
  suites: z.number(),
  testCases: z.number(),
  draftCases: z.number(),
  runs: z.number(),
  executions: z.number(),
  pass: z.number(),
  fail: z.number(),
  blocked: z.number(),
  skipped: z.number(),
  passRate: z.number().nullable(),
});

export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>;
