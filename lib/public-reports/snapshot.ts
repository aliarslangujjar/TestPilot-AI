import { sanitizeEvidenceText } from "@/lib/ai-analysis/evidence";
import { publicReportSnapshotSchema, type PublicReportSnapshot } from "@schemas/public-report";

/**
 * Builds the public report snapshot from normalized run data.
 *
 * This is the data-leakage boundary: the snapshot is a fresh object built
 * ONLY from the fields below. Anything not explicitly copied here cannot
 * leak — workspace/project/run/result/job ids, user emails, run notes,
 * console/network logs, artifact paths, and storage URLs are never inputs.
 * Every free-text value passes through the evidence sanitizer (redacts
 * password=/Bearer/api-key/JWT-shaped values) and a length cap.
 */

export interface SnapshotCaseInput {
  title: string;
  status: string;
  durationMs: number | null;
  expected?: string | null;
  actual?: string | null;
  failedStepAction?: string | null;
  analysis?: {
    probableClassification: string;
    confidence: number;
    uncertainty: string;
  } | null;
}

export interface SnapshotInput {
  projectName: string;
  runName: string;
  source: "manual" | "automated";
  status: string;
  executionStatus: string | null;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  includeFailureDetails: boolean;
  summary: PublicReportSnapshot["summary"];
  cases: SnapshotCaseInput[];
  generatedAt: Date;
}

function clean(text: string | null | undefined, maxLen: number): string | null {
  if (text === null || text === undefined) return null;
  const out = sanitizeEvidenceText(text, maxLen);
  return out.length > 0 ? out : null;
}

export function buildRunSnapshot(input: SnapshotInput): PublicReportSnapshot {
  const cases = input.cases.slice(0, 500).map((c) => {
    const failed = c.status === "failed" || c.status === "fail" || c.status === "timed_out";
    const detail =
      input.includeFailureDetails && failed
        ? {
            failedStepAction: clean(c.failedStepAction ?? null, 60),
            expected: clean(c.expected ?? null, 500),
            actual: clean(c.actual ?? null, 500),
            probableClassification: c.analysis
              ? clean(c.analysis.probableClassification, 60)
              : null,
            confidence: c.analysis ? c.analysis.confidence : null,
            uncertainty: c.analysis ? clean(c.analysis.uncertainty, 1000) : null,
          }
        : undefined;
    return {
      title: clean(c.title, 200) ?? "Untitled case",
      status: c.status.slice(0, 40),
      durationMs: c.durationMs,
      ...(detail ? { detail } : {}),
    };
  });

  return publicReportSnapshotSchema.parse({
    version: 1,
    projectName: clean(input.projectName, 200) ?? "Project",
    runName: clean(input.runName, 200) ?? "Test run",
    source: input.source,
    status: input.status.slice(0, 40),
    executionStatus: input.executionStatus?.slice(0, 40) ?? null,
    generatedAt: input.generatedAt.toISOString(),
    dataAsOf: input.completedAt ?? input.createdAt,
    durationMs: input.durationMs,
    includeFailureDetails: input.includeFailureDetails,
    summary: input.summary,
    cases,
  });
}

/** A report is stale when its underlying run data is over 24h old. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isSnapshotStale(snapshot: PublicReportSnapshot, now: Date): boolean {
  const asOf = Date.parse(snapshot.dataAsOf);
  if (Number.isNaN(asOf)) return true;
  return now.getTime() - asOf > STALE_AFTER_MS;
}
