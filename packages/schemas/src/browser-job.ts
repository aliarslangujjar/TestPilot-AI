import { z } from "zod";

import { browserTestPlanSchema } from "./browser-test";

/**
 * Browser job queue contracts — shared by the web app (enqueue/cancel)
 * and the Playwright worker (claim/execute/report). The worker
 * re-validates everything itself; these schemas are the shape both sides
 * agree on, not a trust boundary.
 */

export const browserJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export type BrowserJobStatus = z.infer<typeof browserJobStatusSchema>;

export const browserJobFailureKindSchema = z.enum(["assertion", "infra", "timeout"]);
export type BrowserJobFailureKind = z.infer<typeof browserJobFailureKindSchema>;

export const enqueueBrowserJobSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  /** Optional link to the automated run and case this job executes for. */
  runId: z.string().uuid().optional(),
  testCaseId: z.string().uuid().optional(),
  /** The v1 browser-test plan. Validated again by the worker. */
  plan: browserTestPlanSchema,
  /** Idempotency key: re-enqueueing the same key returns the existing job. */
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export type EnqueueBrowserJobInput = z.infer<typeof enqueueBrowserJobSchema>;

export const browserJobStepResultSchema = z.object({
  index: z.number().int().min(0),
  action: z.string(),
  ok: z.boolean(),
  durationMs: z.number().int().min(0),
  /** Sanitized, truncated failure message. */
  error: z.string().max(500).optional(),
});

export type BrowserJobStepResult = z.infer<typeof browserJobStepResultSchema>;

export const browserJobResultSchema = z.object({
  status: z.enum(["succeeded", "failed", "cancelled"]),
  steps: z.array(browserJobStepResultSchema),
  /** Storage paths of failure screenshots, if any. */
  artifacts: z.array(z.string().max(500)).default([]),
  startedAt: z.string(),
  finishedAt: z.string(),
});

export type BrowserJobResult = z.infer<typeof browserJobResultSchema>;

export const browserJobSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  /** The automated run and case this job executes for (when run-linked). */
  runId: z.string().uuid().nullable(),
  testCaseId: z.string().uuid().nullable(),
  idempotencyKey: z.string(),
  plan: browserTestPlanSchema,
  status: browserJobStatusSchema,
  /** How the final failure classified: timeouts surface as run `timed_out`. */
  failureKind: browserJobFailureKindSchema.nullable(),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1).max(5),
  cancelRequested: z.boolean(),
  claimedBy: z.string().nullable(),
  claimedAt: z.string().nullable(),
  leaseExpiresAt: z.string().nullable(),
  result: browserJobResultSchema.nullable(),
  error: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BrowserJob = z.infer<typeof browserJobSchema>;
