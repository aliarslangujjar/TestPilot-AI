"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ShareReportPanel } from "@/components/public-reports/share-report-panel";
import { analyzeRunFailure } from "@/lib/ai-analysis/actions";
import { type StoredFailureAnalysis } from "@/lib/ai-analysis/envelope";
import { getArtifactSignedUrl } from "@/lib/run-details/artifacts";
import { ARTIFACT_URL_TTL_SECONDS } from "@/lib/run-details/constants";
import {
  compareAutomatedRuns,
  type CaseChange,
  type RunComparison,
} from "@/lib/run-details/compare";
import {
  getAutomatedRunDetail,
  type AutomatedRunDetail,
  type ResultDetail,
} from "@/lib/run-details/details";
import { refreshAutomatedRun } from "@/lib/test-runs/automated";
import type { ExecutionStatus } from "@schemas/test-run";
import { cn } from "@/lib/utils";

function statusBadge(status: ExecutionStatus | null): string {
  switch (status) {
    case "passed":
      return "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200";
    case "failed":
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
    case "timed_out":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
    case "cancelled":
      return "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
    case "running":
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200";
    default:
      return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
}

function changeBadge(change: CaseChange): string {
  switch (change) {
    case "fixed":
      return "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200";
    case "regressed":
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
    case "still_failing":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
    case "added":
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200";
    default:
      return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

function ResultCard({
  workspaceId,
  projectId,
  runId,
  result,
  onAnalyzed,
}: {
  workspaceId: string;
  projectId: string;
  runId: string;
  result: ResultDetail;
  onAnalyzed: (resultId: string, analysis: StoredFailureAnalysis) => void;
}) {
  const [analysis, setAnalysis] = useState<StoredFailureAnalysis | null>(result.analysis);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [artifactBusy, setArtifactBusy] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  const canAnalyze = result.executionStatus === "failed" || result.executionStatus === "timed_out";

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await analyzeRunFailure(workspaceId, projectId, runId, result.resultId);
      if (res.ok) {
        setAnalysis(res.data);
        onAnalyzed(result.resultId, res.data);
      } else {
        setAnalysisError(res.error);
      }
    } catch {
      setAnalysisError("Analysis failed. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleArtifact(artifactPath: string) {
    setArtifactBusy(artifactPath);
    setArtifactError(null);
    try {
      const res = await getArtifactSignedUrl(workspaceId, projectId, runId, artifactPath);
      if (res.ok) {
        window.open(res.data.url, "_blank", "noopener");
      } else {
        setArtifactError(res.error);
      }
    } catch {
      setArtifactError("Could not open the artifact. Please try again.");
    } finally {
      setArtifactBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{result.caseTitle}</h3>
        <Badge className={statusBadge(result.executionStatus)}>
          {result.executionStatus ?? "—"}
        </Badge>
        {result.failureKind && (
          <span className="text-xs text-muted-foreground">failure: {result.failureKind}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {formatDuration(result.durationMs)}
          {result.attempts !== null
            ? ` · ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}`
            : ""}
        </span>
      </div>

      {/* Expected vs actual — only when the run produced evidence for it. */}
      {(result.expected || result.actual) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-muted p-2.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Expected</p>
            <p className="mt-1 whitespace-pre-wrap">{result.expected ?? "—"}</p>
          </div>
          <div className="rounded-md bg-muted p-2.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Actual (observed)</p>
            <p className="mt-1 whitespace-pre-wrap">{result.actual ?? "—"}</p>
          </div>
        </div>
      )}

      {result.steps.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">#</th>
                <th className="py-1 pr-2 font-medium">Step</th>
                <th className="py-1 pr-2 font-medium">Result</th>
                <th className="py-1 pr-2 font-medium">Duration</th>
                <th className="py-1 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {result.steps.map((step) => (
                <tr key={step.index} className="border-t border-border">
                  <td className="py-1 pr-2">{step.index + 1}</td>
                  <td className="py-1 pr-2 font-mono text-xs">{step.action}</td>
                  <td className="py-1 pr-2">
                    <Badge className={step.ok ? statusBadge("passed") : statusBadge("failed")}>
                      {step.ok ? "ok" : "failed"}
                    </Badge>
                  </td>
                  <td className="py-1 pr-2 text-xs text-muted-foreground">
                    {formatDuration(step.durationMs)}
                  </td>
                  <td className="py-1 font-mono text-xs text-destructive">{step.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(result.logs.consoleErrors.length > 0 || result.logs.networkErrors.length > 0) && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">Sanitized logs</summary>
          <div className="mt-2 space-y-2">
            {result.logs.consoleErrors.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Console errors</p>
                <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                  {result.logs.consoleErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.logs.networkErrors.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Network errors</p>
                <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                  {result.logs.networkErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="mt-3">
        <p className="text-sm font-medium">Artifacts</p>
        {result.artifacts.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No screenshots captured.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {result.artifacts.map((path) => (
              <li key={path} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{path.split("/").pop()}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={artifactBusy !== null}
                  onClick={() => handleArtifact(path)}
                >
                  {artifactBusy === path ? "Opening…" : "Open screenshot"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Links expire after {Math.round(ARTIFACT_URL_TTL_SECONDS / 60)} minutes. Traces are not
          captured by design — they can embed secrets; screenshots only.
        </p>
        {artifactError && <p className="mt-1 text-sm text-destructive">{artifactError}</p>}
      </div>

      {canAnalyze && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-sm font-medium">Failure analysis</p>
          {analysis ? (
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={changeBadge("added")}>
                  {analysis.source === "ai" ? "AI analysis" : "Rule-based analysis"}
                </Badge>
                <Badge className={statusBadge(null)}>
                  probable: {analysis.analysis.probableClassification.replaceAll("_", " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  confidence {Math.round(analysis.analysis.confidence * 100)}%
                  {analysis.model ? ` · ${analysis.model}` : ""}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                A hypothesis based on the recorded evidence — not a confirmed root cause.
              </p>
              <p className="whitespace-pre-wrap">{analysis.analysis.explanation}</p>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Supporting evidence</p>
                <ul className="mt-1 list-disc pl-5">
                  {analysis.analysis.supportingEvidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Uncertainty</p>
                <p className="mt-1">{analysis.analysis.uncertainty}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Debugging steps</p>
                <ol className="mt-1 list-decimal pl-5">
                  {analysis.analysis.debuggingSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
              {analysis.analysis.fixSuggestions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Suggested fixes</p>
                  <ul className="mt-1 list-disc pl-5">
                    {analysis.analysis.fixSuggestions.map((f, i) => (
                      <li key={i}>
                        {f.suggestion}{" "}
                        <span className="text-xs text-muted-foreground">
                          (based on: {f.evidenceBasis})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <Button size="sm" disabled={analyzing} onClick={handleAnalyze}>
                {analyzing ? "Analyzing…" : "Analyze failure"}
              </Button>
              {analysisError && <p className="mt-1 text-sm text-destructive">{analysisError}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AutomatedRunDetail({
  workspaceId,
  projectId,
  projectName,
  initialDetail,
  comparisonRuns,
}: {
  workspaceId: string;
  projectId: string;
  projectName: string;
  initialDetail: AutomatedRunDetail;
  comparisonRuns: Array<{ id: string; name: string; createdAt: string }>;
}) {
  const [detail, setDetail] = useState<AutomatedRunDetail>(initialDetail);
  const [refreshing, setRefreshing] = useState(false);
  const [compareTo, setCompareTo] = useState("");
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const refreshed = await refreshAutomatedRun(workspaceId, projectId, detail.runId);
      if (refreshed.ok) {
        const res = await getAutomatedRunDetail(workspaceId, projectId, detail.runId);
        if (res.ok) setDetail(res.data);
      }
    } finally {
      setRefreshing(false);
    }
  }

  function handleAnalyzed(resultId: string, analysis: StoredFailureAnalysis) {
    setDetail((d) => ({
      ...d,
      results: d.results.map((r) => (r.resultId === resultId ? { ...r, analysis } : r)),
    }));
  }

  async function handleCompare() {
    if (!compareTo) return;
    setComparing(true);
    setCompareError(null);
    try {
      const res = await compareAutomatedRuns(workspaceId, projectId, detail.runId, compareTo);
      if (res.ok) setComparison(res.data);
      else setCompareError(res.error);
    } finally {
      setComparing(false);
    }
  }

  const s = detail.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{detail.name}</h1>
        <Badge className={statusBadge(detail.executionStatus)}>
          {detail.executionStatus ?? "—"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {projectName} · automated · {formatDuration(detail.durationMs)}
        </span>
        <div className="ml-auto">
          <Button variant="outline" size="sm" disabled={refreshing} onClick={handleRefresh}>
            {refreshing ? "Refreshing…" : "Refresh status"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["Passed", s.passed, statusBadge("passed")],
            ["Failed", s.failed, statusBadge("failed")],
            ["Timed out", s.timedOut, statusBadge("timed_out")],
            ["Cancelled", s.cancelled, statusBadge("cancelled")],
            ["Running", s.running, statusBadge("running")],
            ["Queued", s.queued, statusBadge("queued")],
          ] as Array<[string, number, string]>
        ).map(([label, value, cls]) => (
          <span key={label} className={cn("rounded-md bg-muted px-2.5 py-1", cls)}>
            {label}: {value}
          </span>
        ))}
      </div>

      <ShareReportPanel workspaceId={workspaceId} projectId={projectId} runId={detail.runId} />

      <div className="space-y-3">
        {detail.results.map((r) => (
          <ResultCard
            key={r.resultId}
            workspaceId={workspaceId}
            projectId={projectId}
            runId={detail.runId}
            result={r}
            onAnalyzed={handleAnalyzed}
          />
        ))}
      </div>

      {comparisonRuns.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Compare with another run</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={compareTo}
              onChange={(e) => setCompareTo(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              aria-label="Run to compare with"
            >
              <option value="">Select a run…</option>
              {comparisonRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {new Date(r.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!compareTo || comparing} onClick={handleCompare}>
              {comparing ? "Comparing…" : "Compare"}
            </Button>
          </div>
          {compareError && <p className="mt-2 text-sm text-destructive">{compareError}</p>}
          {comparison && (
            <div className="mt-3">
              <div className="flex flex-wrap gap-2 text-sm">
                {(
                  [
                    ["Fixed", comparison.summary.fixed],
                    ["Regressed", comparison.summary.regressed],
                    ["Still failing", comparison.summary.still_failing],
                    ["Added", comparison.summary.added],
                    ["Removed", comparison.summary.removed],
                  ] as Array<[string, number]>
                ).map(([label, value]) => (
                  <span key={label} className="rounded-md bg-muted px-2.5 py-1">
                    {label}: {value}
                  </span>
                ))}
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">Case</th>
                      <th className="py-1 pr-2 font-medium">This run</th>
                      <th className="py-1 pr-2 font-medium">{comparison.otherName}</th>
                      <th className="py-1 pr-2 font-medium">Change</th>
                      <th className="py-1 font-medium">Duration Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.cases.map((c, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 pr-2">{c.caseTitle}</td>
                        <td className="py-1 pr-2">
                          <Badge className={statusBadge(c.baseExecutionStatus)}>
                            {c.baseExecutionStatus ?? "—"}
                          </Badge>
                        </td>
                        <td className="py-1 pr-2">
                          <Badge className={statusBadge(c.otherExecutionStatus)}>
                            {c.otherExecutionStatus ?? "—"}
                          </Badge>
                        </td>
                        <td className="py-1 pr-2">
                          <Badge className={changeBadge(c.change)}>
                            {c.change.replaceAll("_", " ")}
                          </Badge>
                        </td>
                        <td className="py-1 text-xs text-muted-foreground">
                          {c.durationDeltaMs === null
                            ? "—"
                            : `${c.durationDeltaMs >= 0 ? "+" : ""}${Math.round(c.durationDeltaMs / 100) / 10}s`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
