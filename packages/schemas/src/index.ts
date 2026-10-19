/**
 * Shared validation schemas for TestPilot AI.
 *
 * These are foundational primitives shared between the web app and the
 * Playwright worker. Domain schemas (test cases, runs, results) belong here
 * once the product domain is defined — nothing product-specific exists yet.
 */
import { z } from "zod";

/** UUID primary keys used across all tables. */
export const uuidSchema = z.uuid();

/** ISO-8601 date-time strings (UTC) used at API boundaries. */
export const isoDateTimeSchema = z.iso.datetime();

/** Standard list-endpoint pagination query params. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Envelope for API error responses. */
export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Auth form validation schemas (login, sign-up, password reset). */
export * from "./auth";
export * from "./profile";
export * from "./test-run";
export * from "./workspace";

/** Project CRUD validation schemas. */
export * from "./project";

/** Suite validation schemas. */
export * from "./suite";

/** Test-case validation schemas. */
export * from "./test-case";
