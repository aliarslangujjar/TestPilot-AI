import { createHash, randomBytes } from "node:crypto";

/**
 * Share tokens: 256 bits of randomness, base64url-encoded (43 chars).
 * Only the SHA-256 hash is stored — a database leak cannot mint live
 * links, and token comparison never involves the raw value server-side
 * beyond hashing the presented token once.
 */

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedShareToken(token: string): boolean {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}
