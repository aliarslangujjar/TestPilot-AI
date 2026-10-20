import type { Metadata } from "next";

import { getProject } from "@/lib/projects/actions";
import { getCurrentWorkspace } from "@/lib/workspaces";
import { listTestPlans } from "@/lib/test-plans/plans";
import { TestPlansManager } from "@/components/test-plans/test-plans-manager";

export const metadata: Metadata = {
  title: "Test plans — TestPilot AI",
  description: "Generate template-guided test plans and convert them into test cases.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function PlansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test plans</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          You don&apos;t belong to a workspace yet, so there are no projects to show plans for.
        </p>
      </main>
    );
  }

  const project = await getProject(workspace.id, projectId);
  if (!project.ok) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Test plans</h1>
        <p className="mt-4 text-sm text-muted-foreground">Project not found.</p>
      </main>
    );
  }

  const plans = await listTestPlans(workspace.id, projectId);

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <TestPlansManager
        workspaceId={workspace.id}
        projectId={projectId}
        projectName={project.data.name}
        initialPlans={plans.ok ? plans.data : []}
        initialError={plans.ok ? null : plans.error}
      />
    </main>
  );
}
