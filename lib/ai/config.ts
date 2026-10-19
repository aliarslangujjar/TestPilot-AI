import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { aiConfigSchema, type AIConfig, type AIProvider } from "@schemas/ai";

export { AI_MODEL_RATES_USD_PER_MTOK } from "@schemas/ai";

/**
 * Provider-independent AI configuration.
 *
 * The provider is chosen with AI_PROVIDER (openai | anthropic); everything
 * downstream only sees the `LanguageModel` interface, so switching providers
 * is an env change, not a code change. Credentials are read here, in server
 * code, and never leave the server.
 */

/** Low-cost defaults per provider — override with AI_MODEL. */
export const AI_DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
};

/** Pure: parse config from an env-like object (testable without process.env). */
export function parseAIConfig(env: Record<string, string | undefined>): AIConfig {
  return aiConfigSchema.parse({
    AI_PROVIDER: env.AI_PROVIDER,
    AI_MODEL: env.AI_MODEL,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    AI_TIMEOUT_MS: env.AI_TIMEOUT_MS,
    AI_MAX_RETRIES: env.AI_MAX_RETRIES,
    AI_MAX_INPUT_CHARS: env.AI_MAX_INPUT_CHARS,
    AI_DAILY_REQUEST_LIMIT: env.AI_DAILY_REQUEST_LIMIT,
    AI_DAILY_TOKEN_LIMIT: env.AI_DAILY_TOKEN_LIMIT,
  });
}

/** Read the live process env. Throws on invalid values — fail fast. */
export function loadAIConfig(): AIConfig {
  return parseAIConfig(process.env);
}

/** The service is enabled only when the selected provider has an API key. */
export function isAIEnabled(config: AIConfig): boolean {
  return config.AI_PROVIDER === "openai"
    ? config.OPENAI_API_KEY !== undefined
    : config.ANTHROPIC_API_KEY !== undefined;
}

export function resolveModelId(config: AIConfig): string {
  return config.AI_MODEL ?? AI_DEFAULT_MODELS[config.AI_PROVIDER];
}

/**
 * Build the provider's model behind the shared LanguageModel interface.
 * Server-only: throws in the browser so credentials can never leak there.
 */
export function resolveModel(config: AIConfig): LanguageModel {
  if (typeof window !== "undefined") {
    throw new Error("AI models must only be resolved on the server.");
  }
  const modelId = resolveModelId(config);
  if (config.AI_PROVIDER === "anthropic") {
    return createAnthropic({ apiKey: config.ANTHROPIC_API_KEY })(modelId);
  }
  return createOpenAI({ apiKey: config.OPENAI_API_KEY })(modelId);
}
