import type { Metadata } from "next";

import { getCurrentWorkspace } from "@/lib/workspaces";
import { ProjectsManager } from "@/components/projects/projects-manager";

export const metadata: Metadata = {
  title: "Projects — TestPilot AI",
  description: "Manage test projects.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <div className="mt-6 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">No workspace found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Projects live inside a workspace, and you don&apos;t belong to one yet. Ask a workspace
            owner to invite you, then come back here.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <ProjectsManager workspaceId={workspace.id} workspaceName={workspace.name} />
    </main>
  );
}
