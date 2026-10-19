import type { Metadata } from "next";

import { RunDetailManager } from "@/components/test-runs/run-detail-manager";
import { getProject } from "@/lib/projects/actions";
import { getRun, listRunResults } from "@/lib/test-runs/actions";
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

  const [runResult, resultsResult] = await Promise.all([
    getRun(workspace.id, projectId, runId),
    listRunResults(workspace.id, projectId, runId),
  ]);

  if (!runResult.ok) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test run</h1>
        <p className="mt-2 text-sm text-muted-foreground">{runResult.error}</p>
      </main>
    );
  }
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
