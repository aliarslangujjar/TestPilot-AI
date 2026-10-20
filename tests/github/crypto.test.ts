/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/github/crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

beforeEach(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
});

describe("integration secret encryption", () => {
  it("round-trips a secret and never stores plaintext", () => {
    const stored = encryptSecret("github_pat_secretvalue");
    expect(stored).not.toContain("github_pat_secretvalue");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptSecret(stored)).toBe("github_pat_secretvalue");
  });

  it("produces different ciphertext for the same secret (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const stored = encryptSecret("token");
    const parts = stored.split(".");
    const tampered = [...parts.slice(0, 3), Buffer.from("forged").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects decryption under a different key", () => {
    const stored = encryptSecret("token");
    process.env.INTEGRATION_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("throws a clear error when the key is missing or malformed", () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/INTEGRATION_ENCRYPTION_KEY is not set/);
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/exactly 32 bytes/);
  });
});
