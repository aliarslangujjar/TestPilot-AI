import { z } from "zod";

/** Shared workspace validation. */

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "Workspace name must be at least 2 characters.")
  .max(100, "Workspace name must be 100 characters or fewer.");

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});

export type Workspace = z.infer<typeof workspaceSchema>;
