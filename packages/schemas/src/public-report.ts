import { z } from "zod";

/**
 * Public QA reports: an owner creates an opt-in, read-only snapshot of a
 * run that anyone with the unguessable link can view. The snapshot is the
 * ONLY thing the public ever sees — it is built to exclude workspace data
 * by construction: no ids, no emails, no artifact paths or URLs, no logs,
 * no notes. Just the approved summary and (optionally) sanitized failure
 * evidence.
 *
 * Tokens are never stored: only a SHA-256 hash of the token is persisted,
 * so a database leak does not expose live links. Revocation is a column,
 * checked on every public read.
 */

export const publicReportCaseSchema = z.object({
  title: z.string().max(200),
  /** Outcome (manual) or execution status (automated). */
  status: z.string().max(40),
  durationMs: z.number().int().min(0).nullable(),
  /** Present only when the owner opted into failure details. */
  detail: z
    .object({
      failedStepAction: z.string().max(60).nullable(),
      expected: z.string().max(500).nullable(),
      actual: z.string().max(500).nullable(),
      probableClassification: z.string().max(60).nullable(),
      confidence: z.number().min(0).max(1).nullable(),
      uncertainty: z.string().max(1000).nullable(),
    })
    .optional(),
});

export type PublicReportCase = z.infer<typeof publicReportCaseSchema>;

export const publicReportSnapshotSchema = z.object({
  version: z.literal(1),
  projectName: z.string().max(200),
  runName: z.string().max(200),
  source: z.enum(["manual", "automated"]),
  status: z.string().max(40),
  executionStatus: z.string().max(40).nullable(),
  /** When this report was generated (share time). */
  generatedAt: z.string(),
  /** When the underlying run data is from — drives the stale indicator. */
  dataAsOf: z.string(),
  durationMs: z.number().int().min(0).nullable(),
  includeFailureDetails: z.boolean(),
  summary: z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    timedOut: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    blocked: z.number().int().min(0),
    skipped: z.number().int().min(0),
    unexecuted: z.number().int().min(0),
  }),
  cases: z.array(publicReportCaseSchema).max(500),
});

export type PublicReportSnapshot = z.infer<typeof publicReportSnapshotSchema>;

/** Owner-facing metadata — never includes the token or its hash. */
export const publicReportMetaSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  runId: z.uuid(),
  runName: z.string(),
  includeFailureDetails: z.boolean(),
  noIndex: z.boolean(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  viewCount: z.number().int().min(0),
  lastViewedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type PublicReportMeta = z.infer<typeof publicReportMetaSchema>;
