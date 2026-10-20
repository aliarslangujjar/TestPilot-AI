import type { Metadata } from "next";

import { getCurrentWorkspace } from "@/lib/workspaces";
import { listCommunityTemplates, listMyCommunityTemplates } from "@/lib/community/actions";
import { listProjects } from "@/lib/projects/actions";
import { CommunityLibrary } from "@/components/community/community-library";

export const metadata: Metadata = {
  title: "Community templates — TestPilot AI",
  description: "Browse, preview, and import reusable QA templates shared by the community.",
};

export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Community templates</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          You don&apos;t belong to a workspace yet, so there is nothing to browse or import into.
        </p>
      </main>
    );
  }

  const [templates, mine, projects] = await Promise.all([
    listCommunityTemplates(workspace.id),
    listMyCommunityTemplates(workspace.id),
    listProjects(workspace.id),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <CommunityLibrary
        workspaceId={workspace.id}
        initialTemplates={templates.ok ? templates.data : []}
        initialMine={mine.ok ? mine.data : []}
        projects={(projects.ok ? projects.data : []).map((p) => ({ id: p.id, name: p.name }))}
        initialError={templates.ok ? null : templates.error}
      />
    </main>
  );
}
