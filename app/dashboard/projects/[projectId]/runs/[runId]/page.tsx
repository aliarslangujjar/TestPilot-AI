import type { Metadata } from "next";

import { RunDetailManager } from "@/components/test-runs/run-detail-manager";
import { AutomatedRunDetail } from "@/components/test-runs/automated-run-detail";
import { getProject } from "@/lib/projects/actions";
import { getRun, listRunResults, listRuns } from "@/lib/test-runs/actions";
import { getAutomatedRunDetail } from "@/lib/run-details/details";
import { getCurrentWorkspace } from "@/lib/workspaces";

export const metadata: Metadata = {
  title: "Test run — TestPilot AI",
  description: "Test run detail and results.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test run</h1>
        <p className="mt-2 text-sm text-muted-foreground">No workspace found.</p>
      </main>
    );
  }

  const project = await getProject(workspace.id, projectId);
  if (!project.ok) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test run</h1>
        <p className="mt-2 text-sm text-muted-foreground">Project not found.</p>
      </main>
    );
  }

  const runResult = await getRun(workspace.id, projectId, runId);
  if (!runResult.ok) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test run</h1>
        <p className="mt-2 text-sm text-muted-foreground">{runResult.error}</p>
      </main>
    );
  }

  // Automated runs render the worker-evidence detail (steps, expected vs
  // actual, logs, artifacts, AI analysis, comparison) instead of the
  // manual outcome editor.
  if (runResult.data.source === "automated") {
    const [detailResult, runsResult] = await Promise.all([
      getAutomatedRunDetail(workspace.id, projectId, runId),
      listRuns(workspace.id, projectId),
    ]);
    if (!detailResult.ok) {
      return (
        <main className="mx-auto max-w-5xl p-4 sm:p-6">
          <h1 className="text-2xl font-semibold">{runResult.data.name}</h1>
          <p className="mt-2 text-sm text-destructive">{detailResult.error}</p>
        </main>
      );
    }
    const comparisonRuns = runsResult.ok
      ? runsResult.data
          .filter((r) => r.source === "automated" && r.id !== runId)
          .map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt }))
      : [];
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <AutomatedRunDetail
          workspaceId={workspace.id}
          projectId={projectId}
          projectName={project.data.name}
          initialDetail={detailResult.data}
          comparisonRuns={comparisonRuns}
        />
      </main>
    );
  }

  const resultsResult = await listRunResults(workspace.id, projectId, runId);
  if (!resultsResult.ok) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">{runResult.data.name}</h1>
        <p className="mt-2 text-sm text-destructive">{resultsResult.error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <RunDetailManager
        workspaceId={workspace.id}
        projectId={projectId}
        projectName={project.data.name}
        initialRun={runResult.data}
        initialResults={resultsResult.data}
      />
    </main>
  );
}
