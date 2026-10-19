/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  APICallError,
  JSONParseError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";

import { AIServiceError, toAIServiceError } from "@/lib/ai/errors";

describe("toAIServiceError", () => {
  const apiError = (statusCode: number, message = "x") =>
    new APICallError({ message, url: "https://example.test", requestBodyValues: {}, statusCode });

  it("passes AIServiceError through untouched", () => {
    const original = new AIServiceError("AI_QUOTA_EXCEEDED", "quota");
    expect(toAIServiceError(original)).toBe(original);
  });

  it("maps aborts to AI_TIMEOUT", () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const mapped = toAIServiceError(abort);
    expect(mapped.code).toBe("AI_TIMEOUT");
    expect(mapped.retryable).toBe(true);
  });

  it("maps 429/5xx to retryable AI_PROVIDER_ERROR", () => {
    for (const statusCode of [429, 500, 503]) {
      const mapped = toAIServiceError(apiError(statusCode));
      expect(mapped.code).toBe("AI_PROVIDER_ERROR");
      expect(mapped.retryable).toBe(true);
    }
  });

  it("maps 401/403 to non-retryable AI_PROVIDER_ERROR without leaking details", () => {
    const mapped = toAIServiceError(apiError(401, "bad key"));
    expect(mapped.code).toBe("AI_PROVIDER_ERROR");
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).not.toContain("bad key");
  });

  it("maps malformed model output to AI_INVALID_RESPONSE", () => {
    for (const error of [
      new TypeValidationError({ value: null, cause: new Error("bad shape") }),
      new NoObjectGeneratedError({
        message: "no object",
        response: { id: "r", modelId: "m", timestamp: new Date() },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        },
        finishReason: "stop",
      }),
      new JSONParseError({ text: "{", cause: new Error("unexpected end") }),
    ]) {
      const mapped = toAIServiceError(error);
      expect(mapped.code).toBe("AI_INVALID_RESPONSE");
      expect(mapped.retryable).toBe(false);
    }
  });

  it("maps missing API keys to AI_NOT_CONFIGURED", () => {
    const mapped = toAIServiceError(new LoadAPIKeyError({ message: "no key" }));
    expect(mapped.code).toBe("AI_NOT_CONFIGURED");
  });

  it("maps anything else to non-retryable AI_PROVIDER_ERROR", () => {
    const mapped = toAIServiceError(new Error("weird"));
    expect(mapped.code).toBe("AI_PROVIDER_ERROR");
    expect(mapped.retryable).toBe(false);
  });
});
