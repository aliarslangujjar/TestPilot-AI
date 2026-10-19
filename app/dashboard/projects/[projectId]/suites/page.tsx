import type { Metadata } from "next";

import { getProject } from "@/lib/projects/actions";
import { getCurrentWorkspace } from "@/lib/workspaces";
import { TestManagement } from "@/components/test-management/test-management";

export const metadata: Metadata = {
  title: "Test suites — TestPilot AI",
  description: "Manage manual test suites and test cases.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function SuitesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test suites</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          You don&apos;t belong to a workspace yet, so there are no projects to show suites for.
        </p>
      </main>
    );
  }

  const project = await getProject(workspace.id, projectId);
  if (!project.ok) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test suites</h1>
        <p className="mt-4 text-sm text-muted-foreground">Project not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <TestManagement
        workspaceId={workspace.id}
        projectId={projectId}
        projectName={project.data.name}
      />
    </main>
  );
}
