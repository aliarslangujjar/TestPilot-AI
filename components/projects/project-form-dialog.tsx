"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createProject, updateProject } from "@/lib/projects/actions";
import { createProjectSchema } from "@schemas/project";
import type { Project } from "@schemas/project";

import { Dialog } from "./dialog";

const inputClass =
  "mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Create / edit form for a project. Validates instantly with the shared zod
 * schema; the server action re-validates authoritatively.
 */
export function ProjectFormDialog({
  workspaceId,
  project,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  project?: Project;
  onClose: () => void;
  onSaved: (project: Project, mode: "created" | "updated") => void;
}) {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [baseUrl, setBaseUrl] = useState(project?.baseUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createProjectSchema.safeParse({
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your entries and try again.");
      return;
    }

    setPending(true);
    try {
      const result = isEdit
        ? await updateProject(workspaceId, project.id, parsed.data)
        : await createProject(workspaceId, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data, isEdit ? "updated" : "created");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title={isEdit ? "Edit project" : "New project"}
      labelledBy="project-form-title"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="project-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Billing API"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="project-description" className="text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this project cover?"
            rows={3}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="project-base-url" className="text-sm font-medium">
            Authorized base URL{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="project-base-url"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://staging.example.com"
            autoComplete="off"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Stored as data only — TestPilot never fetches this URL or runs tests against it from
            here.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create project"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
