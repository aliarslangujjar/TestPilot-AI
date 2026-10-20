import type { Metadata } from "next";

import { getProject } from "@/lib/projects/actions";
import { getCurrentWorkspace } from "@/lib/workspaces";
import { getGitHubIntegration, listGitHubWorkflowDispatches } from "@/lib/github/actions";
import { GitHubIntegrationPanel } from "@/components/github/github-integration-panel";

export const metadata: Metadata = {
  title: "GitHub Actions — TestPilot AI",
  description: "Connect a GitHub Actions workflow and dispatch runs manually.",
};

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">GitHub Actions</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          You don&apos;t belong to a workspace yet, so there are no projects to connect.
        </p>
      </main>
    );
  }

  const project = await getProject(workspace.id, projectId);
  if (!project.ok) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">GitHub Actions</h1>
        <p className="mt-4 text-sm text-muted-foreground">Project not found.</p>
      </main>
    );
  }

  const integration = await getGitHubIntegration(workspace.id, projectId);
  const dispatches = await listGitHubWorkflowDispatches(workspace.id, projectId);

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <GitHubIntegrationPanel
        workspaceId={workspace.id}
        projectId={projectId}
        projectName={project.data.name}
        initialIntegration={integration.ok ? integration.data : null}
        initialDispatches={dispatches.ok ? dispatches.data : []}
      />
    </main>
  );
}
