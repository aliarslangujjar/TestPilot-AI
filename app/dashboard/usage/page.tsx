import type { Metadata } from "next";

import { getCurrentWorkspace } from "@/lib/workspaces";
import { getWorkspaceUsage } from "@/lib/usage/actions";
import { UsageDashboard } from "@/components/usage/usage-dashboard";

export const metadata: Metadata = {
  title: "Usage — TestPilot AI",
  description: "Workspace usage against the free plan limits for this period.",
};

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          You don&apos;t belong to a workspace yet, so there is no usage to show.
        </p>
      </main>
    );
  }

  const snapshot = await getWorkspaceUsage(workspace.id);

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      {snapshot.ok ? (
        <UsageDashboard snapshot={snapshot.data} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Usage</h1>
          <p className="mt-4 text-sm text-destructive">{snapshot.error}</p>
        </>
      )}
    </main>
  );
}
