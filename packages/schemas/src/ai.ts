import { z } from "zod";

/** Shared AI validation. */

export const aiProviderSchema = z.enum(["openai", "anthropic"]);
export type AIProvider = z.infer<typeof aiProviderSchema>;

/**
 * Server-side AI configuration, parsed from process.env.
 * The service is disabled unless the selected provider's API key is set.
 */
export const aiConfigSchema = z.object({
  AI_PROVIDER: aiProviderSchema.default("openai"),
  AI_MODEL: z.string().trim().min(1).max(100).optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(100).max(100000).default(12000),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100000).default(100),
  AI_DAILY_TOKEN_LIMIT: z.coerce.number().int().min(100).max(100000000).default(200000),
});

export type AIConfig = z.infer<typeof aiConfigSchema>;

/** Input validation for a structured AI request. */
export const structuredRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  system: z.string().trim().min(1).max(4000),
  prompt: z.string().trim().min(1).max(100000),
  label: z.string().trim().min(1).max(60).optional(),
});

export type StructuredRequest = z.infer<typeof structuredRequestSchema>;
