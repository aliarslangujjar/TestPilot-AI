/**
 * Shared project validation schemas. Used by the project CRUD server
 * actions (authoritative) and forms (instant feedback) so the rules can't
 * drift. The base URL is stored as data only — the app never fetches it.
 */
import { z } from "zod";

export const projectNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(100, "Name must be at most 100 characters.");

export const projectDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be at most 2000 characters.")
  .nullish();

export const projectBaseUrlSchema = z
  .url("Enter a valid URL, e.g. https://staging.example.com.")
  .refine((url) => /^https?:\/\//i.test(url), {
    message: "Base URL must start with http:// or https://.",
  })
  .nullish();

export const createProjectSchema = z.object({
  name: projectNameSchema,
  description: projectDescriptionSchema,
  baseUrl: projectBaseUrlSchema,
});

/** Editing a project uses the same shape as creating one. */
export const updateProjectSchema = createProjectSchema;

export const projectSearchSchema = z
  .string()
  .trim()
  .max(100, "Search must be at most 100 characters.");

/** API/database row shape (camelCase) returned by the project actions. */
export const projectSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  baseUrl: z.string().nullable(),
  isArchived: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type Project = z.infer<typeof projectSchema>;
