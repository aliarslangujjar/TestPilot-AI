/**
 * Shared limits for private browser artifacts (binaries in the private
 * `browser-artifacts` bucket, metadata in PostgreSQL).
 */

/** Binaries live in this private bucket; nothing is ever public. */
export const BROWSER_ARTIFACTS_BUCKET = "browser-artifacts";

/** Signed URLs expire after 5 minutes. */
export const ARTIFACT_URL_TTL_SECONDS = 300;

/** Artifact binaries are kept at most 30 days. */
export const ARTIFACT_RETENTION_DAYS = 30;

/** Retention may never be lowered below 7 days (accident protection). */
export const MIN_ARTIFACT_RETENTION_DAYS = 7;

/** Upper bound per prune call — storage list pages stay small. */
export const PRUNE_BATCH_LIMIT = 100;
