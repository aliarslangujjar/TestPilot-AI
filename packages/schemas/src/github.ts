import { z } from "zod";

/**
 * GitHub Actions integration.
 *
 * Opt-in, per project. The app only ever calls the GitHub REST API — it
 * never clones, checks out, or executes repository code. Workflow
 * dispatch inputs are plain strings, validated here.
 */

export const githubRepoOwnerSchema = z
  .string()
  .trim()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "Invalid GitHub owner name.");

export const githubRepoNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "Invalid repository name.")
  .refine((v) => v !== "." && v !== "..", "Invalid repository name.");

export const githubWorkflowFileSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+\.ya?ml$/, "Workflow must be a .yml or .yaml file name.");

export const githubRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Invalid git ref.")
  .refine((v) => !v.includes("..") && !v.endsWith("/") && !v.endsWith("."), "Invalid git ref.");

export const saveGitHubIntegrationSchema = z.object({
  repoOwner: githubRepoOwnerSchema,
  repoName: githubRepoNameSchema,
  workflowFile: githubWorkflowFileSchema,
  defaultRef: githubRefSchema.default("main"),
  /** Required when creating; omit on update to keep the stored token. */
  token: z.string().trim().min(10).max(300).optional(),
});

export type SaveGitHubIntegrationInput = z.infer<typeof saveGitHubIntegrationSchema>;

/** Workflow dispatch inputs: bounded plain-string key/value pairs. */
export const workflowDispatchInputsSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "Invalid input name."),
    z.string().max(1000),
  )
  .refine((obj) => Object.keys(obj).length <= 10, "At most 10 workflow inputs.")
  .default({});

export const githubIntegrationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  repoOwner: z.string(),
  repoName: z.string(),
  workflowFile: z.string(),
  defaultRef: z.string(),
  enabled: z.boolean(),
  hasToken: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GitHubIntegration = z.infer<typeof githubIntegrationSchema>;

export const githubDispatchStatusSchema = z.enum([
  "queued",
  "requested",
  "in_progress",
  "completed",
  "dispatch_failed",
]);

export type GitHubDispatchStatus = z.infer<typeof githubDispatchStatusSchema>;

export const githubWorkflowDispatchSchema = z.object({
  id: z.uuid(),
  status: githubDispatchStatusSchema,
  conclusion: z.string().nullable(),
  githubRunId: z.number().nullable(),
  githubRunUrl: z.string().nullable(),
  ref: z.string(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GitHubWorkflowDispatch = z.infer<typeof githubWorkflowDispatchSchema>;
