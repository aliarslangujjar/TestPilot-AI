import type { Metadata } from "next";

import { getCurrentWorkspace } from "@/lib/workspaces";
import { ProjectsManager } from "@/components/projects/projects-manager";
import { CreateWorkspaceButton } from "@/components/workspaces/create-workspace-button";

export const metadata: Metadata = {
  title: "Projects — TestPilot AI",
  description: "Manage test projects.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { new: newParam } = await searchParams;

  if (!workspace) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <div className="mt-6 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">No workspace yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Projects live inside a workspace. Create one to get started — you&apos;ll be its owner.
          </p>
          <div className="mt-4">
            <CreateWorkspaceButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <ProjectsManager
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        autoOpenCreate={newParam === "1"}
      />
    </main>
  );
}
