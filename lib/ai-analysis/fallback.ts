import type { FailureAnalysis, FailureEvidence } from "@schemas/ai-analysis";

/**
 * Deterministic no-AI fallback analysis.
 *
 * Used when no AI provider is configured — the feature must remain
 * useful (and honest) with AI off. Rules match on sanitized error
 * patterns only; every output keeps hypothesis language, conservative
 * confidence, and an uncertainty note that says plainly this was a
 * rule-based fallback, not a model and not a confirmed root cause.
 */

const LOCATOR_HINTS = [
  "locator",
  "waiting for",
  "strict mode violation",
  "resolved to",
  "not found",
  "no element",
];
const TIMEOUT_HINTS = ["timed out", "timeout", "condition not met within"];
const APP_ERROR_HINTS = ["500", "internal server error", "typeerror", "referenceerror", "uncaught"];

function includesAny(text: string | null, hints: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return hints.some((h) => lower.includes(h));
}

function stepHeadline(evidence: FailureEvidence): string {
  const step =
    evidence.failingStepIndex !== null
      ? `step ${evidence.failingStepIndex + 1}${evidence.failingAction ? ` (${evidence.failingAction})` : ""}`
      : "the job";
  return `In "${evidence.caseTitle}", ${step} did not complete successfully.`;
}

function baseEvidence(evidence: FailureEvidence): string[] {
  const items: string[] = [];
  if (evidence.expected) items.push(`Expected: ${evidence.expected}.`);
  if (evidence.actual) items.push(`Observed: ${evidence.actual}`);
  if (evidence.browserError) items.push(`Browser error: ${evidence.browserError}`);
  for (const e of evidence.consoleErrors.slice(0, 2)) items.push(`Console error: ${e}`);
  for (const e of evidence.networkErrors.slice(0, 2)) items.push(`Network error: ${e}`);
  if (evidence.artifacts.length > 0) {
    items.push(`Failure screenshot captured: ${evidence.artifacts[0]}.`);
  }
  return items.slice(0, 8);
}

const FALLBACK_UNCERTAINTY =
  "This is a rule-based fallback (no AI model was used): the classification is a hypothesis matched from error patterns only, and the underlying cause has not been confirmed. Console/network evidence is capped, so relevant errors may be missing.";

export function fallbackAnalysis(evidence: FailureEvidence): FailureAnalysis {
  const observed = evidence.actual ?? "";
  const locatorAction = ["click", "fill", "assertState", "assertText"].includes(
    evidence.failingAction ?? "",
  );

  // 1. Network evidence is the most specific signal available — whether it
  // came from the run's diagnostics or is embedded in the error text.
  const networkSignal =
    evidence.networkErrors.length > 0 ||
    includesAny(`${observed} ${evidence.browserError ?? ""}`, [
      "net::",
      "econnrefused",
      "dns",
      "failed to load",
    ]);
  if (networkSignal) {
    const networkDetail = evidence.networkErrors[0] ?? observed;
    return {
      explanation: `${stepHeadline(evidence)} Network errors were recorded during the run (${networkDetail}), which suggests the page or one of its resources could not be reached. This is a hypothesis from the recorded errors, not a confirmed cause.`,
      supportingEvidence: baseEvidence(evidence),
      probableClassification: "network_issue",
      confidence: 0.55,
      uncertainty: FALLBACK_UNCERTAINTY,
      debuggingSteps: [
        "Replay the failing request and check its status/response outside the test.",
        "Confirm the target environment was up and reachable at the run's time.",
        "Check whether the failing URL differs from what the test expects (environment/config drift).",
      ],
      fixSuggestions: [
        {
          suggestion:
            "If the target was genuinely down, treat this as an environment failure and re-run once it recovers — no test change is evidenced yet.",
          evidenceBasis: `Network error recorded: ${networkDetail}`,
        },
      ],
    };
  }

  // 2. Server/application errors in console output.
  if (
    evidence.consoleErrors.some((e) => includesAny(e, APP_ERROR_HINTS)) ||
    includesAny(evidence.browserError, APP_ERROR_HINTS)
  ) {
    const appError =
      evidence.consoleErrors.find((e) => includesAny(e, APP_ERROR_HINTS)) ??
      evidence.browserError ??
      "application error";
    return {
      explanation: `${stepHeadline(evidence)} The page reported an application error during the run ("${appError}"), which plausibly prevented the step from succeeding. Whether that error caused this failure is not confirmed.`,
      supportingEvidence: baseEvidence(evidence),
      probableClassification: "application_error",
      confidence: 0.5,
      uncertainty: FALLBACK_UNCERTAINTY,
      debuggingSteps: [
        "Reproduce the flow manually and watch for the same console error.",
        "Check application/server logs around the run's timestamp for a matching exception.",
        "Fix or rule out the console error, then re-run the test unchanged.",
      ],
      fixSuggestions: [
        {
          suggestion:
            "Investigate the recorded application error first; only change the test if the error turns out to be expected behaviour the test should tolerate.",
          evidenceBasis: `Console/browser error recorded: ${appError}`,
        },
      ],
    };
  }

  // 3. Locator problems on locator-driven actions.
  if (locatorAction && includesAny(observed, LOCATOR_HINTS)) {
    return {
      explanation: `${stepHeadline(evidence)} The error pattern ("${observed.slice(0, 160)}") matches a locator that could not resolve its target${evidence.locator ? ` (${evidence.locator})` : ""} — the element may have changed, not rendered, or matched ambiguously. This is the most likely explanation from the error text; it is not confirmed.`,
      supportingEvidence: baseEvidence(evidence),
      probableClassification: "locator_issue",
      confidence: 0.55,
      uncertainty: FALLBACK_UNCERTAINTY,
      debuggingSteps: [
        `Open the failing page state (see the failure screenshot, if one was captured) and look for the target: ${evidence.locator ?? "the step's locator"}.`,
        "Check whether the element's role, label, or text changed in the latest UI build.",
        "Check for duplicate matches (strict-mode violations) if the error mentions resolving to multiple elements.",
      ],
      fixSuggestions: [
        {
          suggestion:
            "If the element's accessible name or role changed, update the plan's locator to the new accessible identity rather than adding waits.",
          evidenceBasis: `Locator error observed: ${observed.slice(0, 200)}`,
        },
      ],
    };
  }

  // 4. Timeouts without a stronger signal.
  if (
    evidence.executionStatus === "timed_out" ||
    evidence.failureKind === "timeout" ||
    includesAny(observed, TIMEOUT_HINTS)
  ) {
    return {
      explanation: `${stepHeadline(evidence)} The run hit a timeout${evidence.expected ? ` while waiting for: ${evidence.expected}` : ""}. Timeouts alone cannot distinguish a slow/flaky render from a genuinely missing outcome — both remain possible.`,
      supportingEvidence: baseEvidence(evidence),
      probableClassification: "timing_or_flake",
      confidence: 0.4,
      uncertainty: FALLBACK_UNCERTAINTY,
      debuggingSteps: [
        "Re-run the same plan unchanged: a pass on retry points to timing/flakiness rather than a product change.",
        "Check the failure screenshot to see how far the page got before the timeout.",
        "Compare the run's timing with recent runs of the same case (environment slowness vs. a new hang).",
      ],
      fixSuggestions: [
        {
          suggestion:
            "Only if re-runs show the content consistently arriving late-but-present, consider raising this step's timeout in the plan; do not raise it to mask a missing element.",
          evidenceBasis: `Timeout observed: ${observed.slice(0, 200) || evidence.browserError || "job-level timeout"}`,
        },
      ],
    };
  }

  // 5. Assertion mismatches (expected vs. observed).
  if (evidence.failingAction === "assertText" || evidence.failingAction === "assertUrl") {
    return {
      explanation: `${stepHeadline(evidence)} The assertion did not hold: expected ${evidence.expected ?? "the asserted value"}, and the observed result was "${(evidence.actual ?? "not recorded").slice(0, 160)}". Either the application state changed or the expectation is stale — the evidence cannot tell which.`,
      supportingEvidence: baseEvidence(evidence),
      probableClassification: "assertion_mismatch",
      confidence: 0.45,
      uncertainty: FALLBACK_UNCERTAINTY,
      debuggingSteps: [
        "Open the page at the failing step and compare the actual content/URL with the expectation.",
        "Check recent product changes for intentional copy/route changes.",
        "Confirm the steps before the assertion put the app in the state the assertion assumes.",
      ],
      fixSuggestions: [
        {
          suggestion:
            "If the new content is intentional, update the plan's expected value; if it is a regression, the test is correct and should stay failing.",
          evidenceBasis: `Expected: ${evidence.expected ?? "n/a"}; observed: ${(evidence.actual ?? "n/a").slice(0, 160)}`,
        },
      ],
    };
  }

  // 6. Nothing matched — say so honestly.
  return {
    explanation: `${stepHeadline(evidence)} The recorded evidence does not match a known failure pattern, so no specific hypothesis is offered. Observed: "${(evidence.actual ?? "no error recorded").slice(0, 200)}".`,
    supportingEvidence: baseEvidence(evidence),
    probableClassification: "unknown",
    confidence: 0.2,
    uncertainty: FALLBACK_UNCERTAINTY,
    debuggingSteps: [
      "Review the failure screenshot and the step's error in the run detail.",
      "Re-run the plan unchanged to see whether the failure reproduces.",
      "If it reproduces, inspect the page manually at the failing step.",
    ],
    fixSuggestions: [],
  };
}
