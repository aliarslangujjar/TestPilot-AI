import type { BrowserJobResult } from "@schemas/browser-job";
import type { BrowserLocator, BrowserTestPlan, BrowserTestStep } from "@schemas/browser-test";
import type { FailureEvidence } from "@schemas/ai-analysis";

/**
 * Evidence construction for failure analysis.
 *
 * The bundle is BOUNDED (every field capped, arrays capped, total size
 * capped) and SANITIZED (ANSI/control stripped, secret-shaped values
 * redacted) before anything is shown to a model — or to the fallback
 * analyzer. Fill VALUES are never included: test data may be credential-
 * shaped and the analysis does not need it.
 */

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const SECRET_PATTERNS: Array<RegExp> = [
  /bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(password|passwd|pwd|api[-_]?key|access[-_]?token|auth[-_]?token|secret)\s*[:=]\s*\S+/gi,
  /\bsk-[A-Za-z0-9]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWT shape
];

export function sanitizeEvidenceText(text: string, maxLen: number): string {
  let cleaned = text.replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
  for (const pattern of SECRET_PATTERNS) cleaned = cleaned.replace(pattern, "[redacted]");
  return cleaned.trim().slice(0, maxLen);
}

function describeLocator(locator: BrowserLocator): string {
  switch (locator.by) {
    case "role":
      return locator.name ? `role ${locator.role} "${locator.name}"` : `role ${locator.role}`;
    case "label":
      return `label "${locator.label}"`;
    case "placeholder":
      return `placeholder "${locator.placeholder}"`;
    case "text":
      return `text "${locator.text}"`;
    case "testId":
      return `test id "${locator.testId}"`;
  }
}

function describeExpected(step: BrowserTestStep): string | null {
  switch (step.action) {
    case "assertText":
      return step.exact
        ? `visible text exactly "${step.text}"`
        : `visible text containing "${step.text}"`;
    case "assertUrl":
      return `URL ${step.match === "contains" ? "containing" : "equal to"} "${step.expected}"`;
    case "assertState":
      return `element to be ${step.state}`;
    case "goto":
      return `navigation to "${step.url}" succeeds`;
    case "click":
      return `${describeLocator(step.locator)} to be clickable`;
    case "fill":
      // Never the value itself — only that a fill was attempted.
      return `${describeLocator(step.locator)} to accept input`;
  }
}

export interface EvidenceJob {
  status: string;
  failure_kind: "assertion" | "infra" | "timeout" | null;
  attempts: number;
  error: string | null;
  plan: BrowserTestPlan;
  result: BrowserJobResult | null;
}

export interface EvidenceResult {
  execution_status: "failed" | "timed_out";
  snapshot: { title: string };
}

const MAX_TOTAL_CHARS = 7000;

/** Build the bounded, sanitized evidence bundle for one failed result. */
export function buildFailureEvidence(result: EvidenceResult, job: EvidenceJob): FailureEvidence {
  const failedStep = job.result?.steps.find((s) => !s.ok) ?? null;
  const planStep = failedStep !== null ? (job.plan.steps[failedStep.index] ?? null) : null;

  const stepError = failedStep?.error ? sanitizeEvidenceText(failedStep.error, 1000) : null;
  const jobError = job.error ? sanitizeEvidenceText(job.error, 1000) : null;

  const evidence: FailureEvidence = {
    caseTitle: sanitizeEvidenceText(result.snapshot.title, 200),
    executionStatus: result.execution_status,
    failingStepIndex: failedStep?.index ?? null,
    failingAction: failedStep?.action ?? null,
    locator:
      planStep && "locator" in planStep
        ? sanitizeEvidenceText(describeLocator(planStep.locator), 300)
        : null,
    expected: planStep
      ? sanitizeEvidenceText(describeExpected(planStep) ?? "", 1000) || null
      : null,
    actual: stepError ?? jobError,
    browserError: jobError && jobError !== stepError ? jobError : null,
    consoleErrors: (job.result?.diagnostics?.consoleErrors ?? [])
      .slice(0, 5)
      .map((e) => sanitizeEvidenceText(e, 300)),
    networkErrors: (job.result?.diagnostics?.networkErrors ?? [])
      .slice(0, 5)
      .map((e) => sanitizeEvidenceText(e, 300)),
    artifacts: (job.result?.artifacts ?? []).slice(0, 5).map((a) => a.slice(0, 500)),
    attempts: job.attempts,
    failureKind: job.failure_kind,
  };

  // Total-size bound: trim diagnostics arrays first (least load-bearing).
  while (JSON.stringify(evidence).length > MAX_TOTAL_CHARS) {
    if (evidence.networkErrors.length > 0) evidence.networkErrors.pop();
    else if (evidence.consoleErrors.length > 0) evidence.consoleErrors.pop();
    else if (evidence.artifacts.length > 0) evidence.artifacts.pop();
    else break;
  }
  return evidence;
}
