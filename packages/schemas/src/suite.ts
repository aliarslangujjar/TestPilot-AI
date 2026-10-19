/**
 * Shared suite validation schemas. Used by the suite server actions
 * (authoritative) and forms (instant feedback) so the rules can't drift.
 */
import { z } from "zod";

export const suiteNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(100, "Name must be at most 100 characters.");

export const suiteDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be at most 2000 characters.")
  .nullish();

export const createSuiteSchema = z.object({
  name: suiteNameSchema,
  description: suiteDescriptionSchema,
});

/** Editing a suite uses the same shape as creating one. */
export const updateSuiteSchema = createSuiteSchema;

/** API/database row shape (camelCase) returned by the suite actions. */
export const suiteSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isArchived: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateSuiteInput = z.infer<typeof createSuiteSchema>;
export type UpdateSuiteInput = z.infer<typeof updateSuiteSchema>;
export type Suite = z.infer<typeof suiteSchema>;
