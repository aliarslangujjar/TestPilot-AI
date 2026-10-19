"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { listProjects, setProjectArchived } from "@/lib/projects/actions";
import type { Project } from "@schemas/project";
import { cn } from "@/lib/utils";

import { ProjectDetailDialog, formatDateTime } from "./project-detail-dialog";
import { ProjectFormDialog } from "./project-form-dialog";

/**
 * Project list with search, create, edit, view, and archive.
 * All data operations go through the project server actions, which enforce
 * workspace permissions on every call.
 */
export function ProjectsManager({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formTarget, setFormTarget] = useState<{ project?: Project } | null>(null);
  const [viewing, setViewing] = useState<Project | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const firstRun = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  function flashNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }

  const load = useCallback(
    async (search: string, includeArchived: boolean, initial: boolean) => {
      if (initial) setInitialLoading(true);
      else setRefreshing(true);
      setError(null);
      const result = await listProjects(workspaceId, {
        search: search ? search : undefined,
        includeArchived,
      });
      if (result.ok) {
        setProjects(result.data);
      } else {
        setError(result.error);
      }
      setInitialLoading(false);
      setRefreshing(false);
    },
    [workspaceId],
  );

  // Initial load immediately; search / archived-toggle debounced.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      load("", showArchived, true);
      return;
    }
    const t = setTimeout(() => load(query.trim(), showArchived, false), 400);
    return () => clearTimeout(t);
  }, [query, showArchived, load]);

  async function handleArchive(project: Project, archived: boolean) {
    setArchiving(true);
    setError(null);
    const result = await setProjectArchived(workspaceId, project.id, archived);
    setArchiving(false);
    setConfirmingArchive(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flashNotice(archived ? `“${project.name}” archived.` : `“${project.name}” restored.`);
    load(query.trim(), showArchived, false);
  }

  const isFiltering = query.trim() !== "" || showArchived;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{workspaceName}</p>
        </div>
        <Button onClick={() => setFormTarget({})}>New project</Button>
      </div>

      {notice && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p role="status">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-medium underline-offset-4 hover:underline"
            aria-label="Dismiss notification"
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              load(query.trim(), showArchived, false);
            }}
            className="font-medium text-destructive underline-offset-4 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <input
            id="project-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects by name…"
            autoComplete="off"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {refreshing && (
          <span className="text-xs text-muted-foreground" role="status">
            Searching…
          </span>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Show archived
        </label>
      </div>

      <div className="mt-4">
        {initialLoading ? (
          <div className="space-y-2" aria-label="Loading projects" role="status">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md border bg-muted/50" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            {isFiltering ? (
              <>
                <p className="font-medium">No projects match your filters</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different search, or turn off “Show archived”.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">No projects yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create your first project to organize test runs against an authorized base URL.
                </p>
                <Button className="mt-4" onClick={() => setFormTarget({})}>
                  Create project
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Base URL
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Updated
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{project.name}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                      {project.baseUrl ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateTime(project.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                          project.isArchived
                            ? "bg-muted text-muted-foreground"
                            : "bg-green-100 text-green-900",
                        )}
                      >
                        {project.isArchived ? "Archived" : "Active"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {confirmingArchive === project.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            Archive this project?
                          </span>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={archiving}
                            onClick={() => handleArchive(project, true)}
                          >
                            {archiving ? "Archiving…" : "Confirm"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={archiving}
                            onClick={() => setConfirmingArchive(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Link
                            href={`/dashboard/projects/${project.id}/suites`}
                            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                          >
                            Suites
                          </Link>
                          <Button size="sm" variant="ghost" onClick={() => setViewing(project)}>
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setFormTarget({ project })}
                          >
                            Edit
                          </Button>
                          {project.isArchived ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={archiving}
                              onClick={() => handleArchive(project, false)}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={archiving}
                              onClick={() => setConfirmingArchive(project.id)}
                            >
                              Archive
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formTarget && (
        <ProjectFormDialog
          workspaceId={workspaceId}
          project={formTarget.project}
          onClose={() => setFormTarget(null)}
          onSaved={(saved, mode) => {
            setFormTarget(null);
            setViewing(null);
            flashNotice(
              mode === "created"
                ? `Project “${saved.name}” created.`
                : `Project “${saved.name}” updated.`,
            );
            load(query.trim(), showArchived, false);
          }}
        />
      )}

      {viewing && !formTarget && (
        <ProjectDetailDialog
          project={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => setFormTarget({ project: viewing })}
        />
      )}
    </div>
  );
}
