"use client";

import { Button } from "@/components/ui/button";
import type { Project } from "@schemas/project";

import { Dialog } from "./dialog";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Read-only detail view for a single project. */
export function ProjectDetailDialog({
  project,
  onClose,
  onEdit,
}: {
  project: Project;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Dialog title={project.name} labelledBy="project-detail-title" onClose={onClose}>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-muted-foreground">Description</dt>
          <dd className="mt-0.5">{project.description || "—"}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Authorized base URL</dt>
          <dd className="mt-0.5">
            {project.baseUrl ? (
              <a
                href={project.baseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {project.baseUrl}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="flex gap-6">
          <div>
            <dt className="font-medium text-muted-foreground">Status</dt>
            <dd className="mt-0.5">{project.isArchived ? "Archived" : "Active"}</dd>
          </div>
        </div>
        <div className="flex gap-6">
          <div>
            <dt className="font-medium text-muted-foreground">Created</dt>
            <dd className="mt-0.5">{formatDateTime(project.createdAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Last updated</dt>
            <dd className="mt-0.5">{formatDateTime(project.updatedAt)}</dd>
          </div>
        </div>
      </dl>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </Dialog>
  );
}
