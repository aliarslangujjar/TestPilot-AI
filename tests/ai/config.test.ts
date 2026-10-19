/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { isAIEnabled, parseAIConfig, resolveModelId } from "@/lib/ai/config";

describe("parseAIConfig", () => {
  it("applies safe defaults when nothing is set", () => {
    const config = parseAIConfig({});
    expect(config.AI_PROVIDER).toBe("openai");
    expect(config.AI_MODEL).toBeUndefined();
    expect(config.AI_TIMEOUT_MS).toBe(30000);
    expect(config.AI_MAX_RETRIES).toBe(2);
    expect(config.AI_MAX_INPUT_CHARS).toBe(12000);
    expect(config.AI_DAILY_REQUEST_LIMIT).toBe(100);
    expect(config.AI_DAILY_TOKEN_LIMIT).toBe(200000);
  });

  it("accepts anthropic and explicit overrides", () => {
    const config = parseAIConfig({
      AI_PROVIDER: "anthropic",
      AI_MODEL: "custom-model",
      AI_TIMEOUT_MS: "5000",
      AI_MAX_RETRIES: "0",
      AI_DAILY_REQUEST_LIMIT: "10",
    });
    expect(config.AI_PROVIDER).toBe("anthropic");
    expect(config.AI_MODEL).toBe("custom-model");
    expect(config.AI_TIMEOUT_MS).toBe(5000);
    expect(config.AI_MAX_RETRIES).toBe(0);
    expect(config.AI_DAILY_REQUEST_LIMIT).toBe(10);
  });

  it("rejects unknown providers and out-of-range values", () => {
    expect(() => parseAIConfig({ AI_PROVIDER: "gemini" })).toThrow();
    expect(() => parseAIConfig({ AI_MAX_RETRIES: "99" })).toThrow();
    expect(() => parseAIConfig({ AI_TIMEOUT_MS: "0" })).toThrow();
  });
});

describe("isAIEnabled", () => {
  it("is disabled without the selected provider's key", () => {
    expect(isAIEnabled(parseAIConfig({}))).toBe(false);
    expect(isAIEnabled(parseAIConfig({ AI_PROVIDER: "anthropic", OPENAI_API_KEY: "x" }))).toBe(
      false,
    );
  });

  it("is enabled when the selected provider's key is set", () => {
    expect(isAIEnabled(parseAIConfig({ OPENAI_API_KEY: "x" }))).toBe(true);
    expect(isAIEnabled(parseAIConfig({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" }))).toBe(
      true,
    );
  });
});

describe("resolveModelId", () => {
  it("uses low-cost defaults unless AI_MODEL overrides", () => {
    expect(resolveModelId(parseAIConfig({}))).toBe("gpt-4o-mini");
    expect(resolveModelId(parseAIConfig({ AI_PROVIDER: "anthropic" }))).toBe(
      "claude-3-5-haiku-20241022",
    );
    expect(resolveModelId(parseAIConfig({ AI_MODEL: "gpt-5-mini" }))).toBe("gpt-5-mini");
  });
});
