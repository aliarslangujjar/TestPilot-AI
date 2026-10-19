"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/projects/dialog";
import { createSuite, updateSuite } from "@/lib/suites/actions";
import { createSuiteSchema } from "@schemas/suite";
import type { Suite } from "@schemas/suite";

const inputClass =
  "mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Create / edit form for a test suite. */
export function SuiteFormDialog({
  workspaceId,
  projectId,
  suite,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  projectId: string;
  suite?: Suite;
  onClose: () => void;
  onSaved: (suite: Suite, mode: "created" | "updated") => void;
}) {
  const isEdit = !!suite;
  const [name, setName] = useState(suite?.name ?? "");
  const [description, setDescription] = useState(suite?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createSuiteSchema.safeParse({
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your entries and try again.");
      return;
    }

    setPending(true);
    try {
      const result = isEdit
        ? await updateSuite(workspaceId, projectId, suite.id, parsed.data)
        : await createSuite(workspaceId, projectId, parsed.data);
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
      title={isEdit ? "Edit suite" : "New suite"}
      labelledBy="suite-form-title"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="suite-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="suite-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Smoke tests"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="suite-description" className="text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="suite-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this suite cover?"
            rows={3}
            className={inputClass}
          />
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
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create suite"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
