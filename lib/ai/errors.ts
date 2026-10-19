import {
  APICallError,
  JSONParseError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";

/**
 * Typed AI errors. Every failure out of lib/ai surfaces as one of these —
 * never a raw SDK error, never a leaked API key or stack trace.
 */

export type AIErrorCode =
  | "AI_DISABLED"
  | "AI_NOT_CONFIGURED"
  | "AI_QUOTA_EXCEEDED"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "AI_INVALID_RESPONSE"
  | "AI_INPUT_TOO_LONG";

export class AIServiceError extends Error {
  readonly code: AIErrorCode;
  /** True when retrying the same request later may succeed. */
  readonly retryable: boolean;

  constructor(code: AIErrorCode, message: string, opts?: { retryable?: boolean; cause?: unknown }) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    if (opts?.cause !== undefined) {
      // Preserve the underlying error for server logs without exposing it.
      this.cause = opts.cause;
    }
  }
}

export function isAIServiceError(error: unknown): error is AIServiceError {
  return error instanceof AIServiceError;
}

function getStatusCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return undefined;
}

/** Unwrap the SDK's retry wrapper to get at the last underlying failure. */
function unwrap(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "lastError" in error &&
    (error as { lastError: unknown }).lastError
  ) {
    return (error as { lastError: unknown }).lastError;
  }
  return error;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: unknown }).name === "AbortError" ||
      (error instanceof Error && /abort/i.test(error.message)))
  );
}

/**
 * Classify any raw failure (SDK error, network error, timeout) into a typed
 * AIServiceError with a user-safe message.
 */
export function toAIServiceError(error: unknown): AIServiceError {
  if (error instanceof AIServiceError) return error;
  const root = unwrap(error);

  if (isAbort(root)) {
    return new AIServiceError("AI_TIMEOUT", "The AI request timed out. Please try again.", {
      retryable: true,
      cause: error,
    });
  }

  const statusCode = getStatusCode(root);
  if (root instanceof APICallError || statusCode !== undefined) {
    if (statusCode === 401 || statusCode === 403) {
      return new AIServiceError(
        "AI_PROVIDER_ERROR",
        "The AI provider rejected the request. The API key may be invalid.",
        { retryable: false, cause: error },
      );
    }
    const retryable =
      statusCode === 408 || statusCode === 425 || statusCode === 429 || (statusCode ?? 0) >= 500;
    return new AIServiceError(
      "AI_PROVIDER_ERROR",
      retryable
        ? "The AI provider is temporarily unavailable. Please try again."
        : "The AI provider returned an error.",
      { retryable, cause: error },
    );
  }

  if (
    root instanceof TypeValidationError ||
    root instanceof NoObjectGeneratedError ||
    root instanceof JSONParseError
  ) {
    return new AIServiceError(
      "AI_INVALID_RESPONSE",
      "The AI returned an unexpected response. Please try again.",
      { retryable: false, cause: error },
    );
  }

  if (root instanceof LoadAPIKeyError) {
    return new AIServiceError("AI_NOT_CONFIGURED", "AI is not configured.", { cause: error });
  }

  return new AIServiceError("AI_PROVIDER_ERROR", "The AI request failed. Please try again.", {
    retryable: false,
    cause: error,
  });
}
