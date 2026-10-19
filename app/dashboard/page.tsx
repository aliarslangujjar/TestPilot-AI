import type { Metadata } from "next";

import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { CreateWorkspaceButton } from "@/components/workspaces/create-workspace-button";
import { getCurrentWorkspace } from "@/lib/workspaces";

export const metadata: Metadata = {
  title: "Analytics — TestPilot AI",
  description: "Execution analytics from real run data.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="mt-6 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">No workspace yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Analytics are computed from your runs. Create a workspace to get started — you&apos;ll
            be its owner.
          </p>
          <div className="mt-4">
            <CreateWorkspaceButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <AnalyticsDashboard workspaceId={workspace.id} workspaceName={workspace.name} />
    </main>
  );
}
