import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getOverviewStats } from "@/lib/overview/actions";
import { getCurrentWorkspace } from "@/lib/workspaces";
import { formatDateTime } from "@/components/projects/project-detail-dialog";
import { CreateWorkspaceButton } from "@/components/workspaces/create-workspace-button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Overview — TestPilot AI",
  description: "Workspace overview.",
};

// Auth-gated and user-specific: always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const workspace = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <div className="mt-6 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">No workspace yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Projects, suites, and test cases live inside a workspace. Create one to get started —
            you&apos;ll be its owner.
          </p>
          <div className="mt-4">
            <CreateWorkspaceButton />
          </div>
        </div>
      </main>
    );
  }

  const stats = await getOverviewStats(workspace.id);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{workspace.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/projects?new=1" className={cn(buttonVariants({ size: "sm" }))}>
            New project
          </Link>
          <Link
            href="/dashboard/projects"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Manage projects
          </Link>
        </div>
      </div>

      {!stats.ok ? (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p role="alert" className="text-destructive">
            {stats.error}
          </p>
        </div>
      ) : stats.data.projects === 0 ? (
        <div className="mt-6 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">Welcome to TestPilot AI</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Create your first project to start organizing test suites and manual test cases.
          </p>
          <Link href="/dashboard/projects" className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
            Go to projects
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Active projects", value: stats.data.projects },
              { label: "Test suites", value: stats.data.suites },
              { label: "Test cases", value: stats.data.testCases },
              { label: "Draft cases", value: stats.data.draftCases },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border bg-card p-5">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-3xl font-bold">{stat.value}</p>
              </div>
            ))}
          </div>

          <section className="mt-8" aria-label="Recently updated test cases">
            <h2 className="text-lg font-semibold">Recently updated test cases</h2>
            {stats.data.recentCases.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No test cases yet. Open a project to create your first suite.
              </p>
            ) : (
              <ul className="mt-3 divide-y rounded-lg border bg-card">
                {stats.data.recentCases.map((testCase) => (
                  <li
                    key={testCase.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{testCase.title}</p>
                      <p className="text-xs text-muted-foreground">{testCase.suiteName}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-medium",
                          testCase.status === "active"
                            ? "bg-green-100 text-green-900"
                            : "bg-slate-100 text-slate-700",
                        )}
                      >
                        {testCase.status}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDateTime(testCase.updatedAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
