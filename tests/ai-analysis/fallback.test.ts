import { describe, expect, it } from "vitest";

import type { FailureEvidence } from "@schemas/ai-analysis";

import { fallbackAnalysis } from "@/lib/ai-analysis/fallback";

function evidence(over: Partial<FailureEvidence> = {}): FailureEvidence {
  return {
    caseTitle: "Login flow",
    executionStatus: "failed",
    failingStepIndex: 1,
    failingAction: "assertText",
    locator: "role heading",
    expected: 'visible text containing "Welcome"',
    actual: "Condition not met within 15000ms.",
    browserError: null,
    consoleErrors: [],
    networkErrors: [],
    artifacts: [],
    attempts: 1,
    failureKind: "assertion",
    ...over,
  };
}

describe("fallbackAnalysis", () => {
  it("classifies locator resolution errors as locator_issue with evidence-cited fixes", () => {
    const analysis = fallbackAnalysis(
      evidence({
        failingAction: "fill",
        actual: "locator.fill: waiting for getByLabel('Email') — locator resolved to 0 elements",
      }),
    );
    expect(analysis.probableClassification).toBe("locator_issue");
    expect(analysis.fixSuggestions.length).toBeGreaterThan(0);
    for (const fix of analysis.fixSuggestions) {
      expect(fix.evidenceBasis.length).toBeGreaterThan(0);
    }
  });

  it("classifies plain assertion mismatches as assertion_mismatch", () => {
    const analysis = fallbackAnalysis(evidence({ actual: "text mismatch: expected 'Welcome'" }));
    expect(analysis.probableClassification).toBe("assertion_mismatch");
  });

  it("classifies timeouts as timing_or_flake and says a pass on retry would point there", () => {
    const analysis = fallbackAnalysis(
      evidence({
        failingAction: "goto",
        executionStatus: "timed_out",
        failureKind: "timeout",
        actual: "Job timed out after 120000ms.",
      }),
    );
    expect(analysis.probableClassification).toBe("timing_or_flake");
    expect(analysis.debuggingSteps.join(" ")).toMatch(/re-run/i);
  });

  it("classifies network errors during navigation as network_issue", () => {
    const analysis = fallbackAnalysis(
      evidence({
        failingAction: "goto",
        actual: "page.goto: net::ERR_CONNECTION_REFUSED",
        networkErrors: ["GET https://app.example.com/login (net::ERR_CONNECTION_REFUSED)"],
      }),
    );
    expect(analysis.probableClassification).toBe("network_issue");
  });

  it("classifies console 500s as application_error", () => {
    const analysis = fallbackAnalysis(
      evidence({ consoleErrors: ["Failed to load resource: 500 Internal Server Error"] }),
    );
    expect(analysis.probableClassification).toBe("application_error");
  });

  it("admits unknown when nothing matches, with no fixes offered", () => {
    const analysis = fallbackAnalysis(
      evidence({ failingAction: "goto", actual: "Something entirely novel happened." }),
    );
    expect(analysis.probableClassification).toBe("unknown");
    expect(analysis.confidence).toBeLessThanOrEqual(0.3);
    expect(analysis.fixSuggestions).toHaveLength(0);
  });

  it("is always honest: hypothesis language, fallback-labelled uncertainty, bounded confidence", () => {
    for (const over of [
      {},
      { failingAction: "fill", actual: "locator resolved to 0 elements" },
      { executionStatus: "timed_out" as const },
    ]) {
      const analysis = fallbackAnalysis(evidence(over));
      expect(analysis.uncertainty).toContain("rule-based fallback");
      expect(analysis.uncertainty).toMatch(/not been confirmed|not a confirmed/i);
      expect(analysis.explanation).not.toMatch(/root cause was/i);
      expect(analysis.confidence).toBeLessThanOrEqual(0.6);
      expect(analysis.supportingEvidence.length).toBeGreaterThan(0);
    }
  });
});
