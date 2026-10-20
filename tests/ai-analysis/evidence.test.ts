import { describe, expect, it } from "vitest";

import { browserTestPlanSchema } from "@schemas/browser-test";

import {
  buildFailureEvidence,
  sanitizeEvidenceText,
  type EvidenceJob,
  type EvidenceResult,
} from "@/lib/ai-analysis/evidence";

const PLAN = browserTestPlanSchema.parse({
  version: "1",
  name: "Login flow",
  baseUrl: "https://app.example.com",
  allowedHosts: ["app.example.com"],
  steps: [
    { action: "goto", url: "/login" },
    { action: "fill", locator: { by: "label", label: "Email" }, value: "qa@example.com" },
    { action: "assertText", locator: { by: "role", role: "heading" }, text: "Welcome" },
  ],
});

const RESULT_OK: EvidenceResult = {
  execution_status: "failed",
  snapshot: { title: "Login flow" },
};

function makeJob(over: Partial<EvidenceJob> = {}): EvidenceJob {
  return {
    status: "failed",
    failure_kind: "assertion",
    attempts: 1,
    error: null,
    plan: PLAN,
    result: {
      status: "failed",
      steps: [
        { index: 0, action: "goto", ok: true, durationMs: 100 },
        {
          index: 1,
          action: "fill",
          ok: false,
          durationMs: 50,
          error: "locator resolved to 0 elements",
        },
      ],
      artifacts: ["ws/run/step-1.png"],
      startedAt: "2026-10-19T21:00:00.000Z",
      finishedAt: "2026-10-19T21:01:00.000Z",
    },
    ...over,
  };
}

describe("buildFailureEvidence", () => {
  it("extracts the failed step, expected, and actual from the plan and result", () => {
    const evidence = buildFailureEvidence(RESULT_OK, makeJob());
    expect(evidence.failingStepIndex).toBe(1);
    expect(evidence.failingAction).toBe("fill");
    expect(evidence.locator).toBe('label "Email"');
    expect(evidence.actual).toContain("locator resolved to 0 elements");
    expect(evidence.artifacts).toEqual(["ws/run/step-1.png"]);
  });

  it("never includes fill values — only the locator is described", () => {
    const evidence = buildFailureEvidence(RESULT_OK, makeJob());
    expect(evidence.expected).toContain('label "Email"');
    expect(evidence.expected).not.toContain("qa@example.com");
    expect(JSON.stringify(evidence)).not.toContain("qa@example.com");
  });

  it("describes assertions with their expected values", () => {
    const job = makeJob({
      result: {
        status: "failed",
        steps: [
          { index: 2, action: "assertText", ok: false, durationMs: 5, error: "Condition not met" },
        ],
        artifacts: [],
        startedAt: "2026-10-19T21:00:00.000Z",
        finishedAt: "2026-10-19T21:01:00.000Z",
      },
    });
    const evidence = buildFailureEvidence(RESULT_OK, job);
    expect(evidence.expected).toBe('visible text containing "Welcome"');
  });

  it("handles a timeout with no failed step: action is null, error is the job error", () => {
    const job = makeJob({
      failure_kind: "timeout",
      error: "Job timed out after 120000ms.",
      result: {
        status: "failed",
        steps: [{ index: 0, action: "goto", ok: true, durationMs: 100 }],
        artifacts: [],
        startedAt: "2026-10-19T21:00:00.000Z",
        finishedAt: "2026-10-19T21:01:00.000Z",
      },
    });
    const evidence = buildFailureEvidence({ ...RESULT_OK, execution_status: "timed_out" }, job);
    expect(evidence.failingStepIndex).toBeNull();
    expect(evidence.failingAction).toBeNull();
    expect(evidence.actual).toContain("timed out");
  });

  it("caps arrays and total size", () => {
    const job = makeJob({
      result: {
        status: "failed",
        steps: [{ index: 0, action: "goto", ok: false, durationMs: 1, error: "boom" }],
        artifacts: ["a", "b", "c", "d", "e", "f", "g"].map((n) => `ws/run/step-${n}.png`),
        diagnostics: {
          consoleErrors: Array.from(
            { length: 20 },
            (_, i) => `console error ${i} ${"x".repeat(500)}`,
          ),
          networkErrors: Array.from(
            { length: 20 },
            (_, i) => `network error ${i} ${"y".repeat(500)}`,
          ),
        },
        startedAt: "2026-10-19T21:00:00.000Z",
        finishedAt: "2026-10-19T21:01:00.000Z",
      },
    });
    const evidence = buildFailureEvidence(RESULT_OK, job);
    expect(evidence.consoleErrors.length).toBeLessThanOrEqual(5);
    expect(evidence.networkErrors.length).toBeLessThanOrEqual(5);
    expect(evidence.artifacts.length).toBeLessThanOrEqual(5);
    for (const e of [...evidence.consoleErrors, ...evidence.networkErrors]) {
      expect(e.length).toBeLessThanOrEqual(300);
    }
    expect(JSON.stringify(evidence).length).toBeLessThanOrEqual(7000);
  });

  it("sanitizes ANSI, control chars, and secret-shaped values", () => {
    const raw =
      "\u001b[31mred\u001b[0m text\x07 with password=hunter2 and Bearer abc.def.ghi token";
    const cleaned = sanitizeEvidenceText(raw, 500);
    expect(cleaned).not.toContain("\u001b");
    expect(cleaned).not.toContain("hunter2");
    expect(cleaned).toContain("[redacted]");
  });

  it("redacts JWT-shaped values", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(sanitizeEvidenceText(`token ${jwt} here`, 500)).toContain("[redacted]");
    expect(sanitizeEvidenceText(`token ${jwt} here`, 500)).not.toContain("eyJ");
  });
});
