import { z } from "zod";

import { failureAnalysisSchema, failureAnalysisSourceSchema } from "@schemas/ai-analysis";

/**
 * The persisted failure-analysis envelope: analysis + provenance.
 *
 * Lives outside any "use server" module so client components may import
 * server actions from lib/ai-analysis/actions.ts without tripping
 * Next's "all exports must be async" rule for action files.
 */
export interface StoredFailureAnalysis {
  analysis: z.infer<typeof failureAnalysisSchema>;
  source: z.infer<typeof failureAnalysisSourceSchema>;
  model: string | null;
  analyzedAt: string;
}

const storedEnvelopeSchema = z.object({
  analysis: failureAnalysisSchema,
  source: failureAnalysisSourceSchema,
  model: z.string().nullable(),
  analyzedAt: z.string(),
});

/** Parse a stored failure-analysis envelope; null when absent/corrupt. */
export function parseStoredFailureAnalysis(stored: unknown): StoredFailureAnalysis | null {
  if (stored === null || stored === undefined) return null;
  const parsed = storedEnvelopeSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
