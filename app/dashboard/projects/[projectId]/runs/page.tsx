import type { Metadata } from "next";

import { RunsManager } from "@/components/test-runs/runs-manager";
import { getProject } from "@/lib/projects/actions";
import { getCurrentWorkspace } from "@/lib/workspaces";

export const metadata: Metadata = {
  title: "Test runs — TestPilot AI",
  description: "Manual test execution history.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function RunsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test runs</h1>
        <p className="mt-2 text-sm text-muted-foreground">No workspace found.</p>
      </main>
    );
  }

  const project = await getProject(workspace.id, projectId);
  if (!project.ok) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test runs</h1>
        <p className="mt-2 text-sm text-muted-foreground">Project not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <RunsManager
        workspaceId={workspace.id}
        projectId={projectId}
        projectName={project.data.name}
      />
    </main>
  );
}
