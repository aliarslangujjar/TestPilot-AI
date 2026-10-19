"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/projects/dialog";
import { createWorkspace } from "@/lib/workspaces/actions";
import { createWorkspaceSchema } from "@schemas/workspace";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Button + dialog for creating the user's first workspace. Used in the
 * "no workspace" empty states of the dashboard.
 */
export function CreateWorkspaceButton({ label = "Create workspace" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setOpen(false);
    setName("");
    setFieldError(null);
    setServerError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const parsed = createWorkspaceSchema.safeParse({ name });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid name.");
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      const result = await createWorkspace(parsed.data);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      close();
      router.refresh();
      router.push("/dashboard/projects");
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {open && (
        <Dialog title="Create workspace" labelledBy="create-workspace-title" onClose={close}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {serverError && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive"
              >
                {serverError}
              </p>
            )}
            <div>
              <label htmlFor="workspace-name" className="mb-1 block text-sm font-medium">
                Workspace name
              </label>
              <input
                id="workspace-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="Acme QA"
                className={cn(inputClass, fieldError && "border-destructive")}
                aria-invalid={!!fieldError}
                aria-describedby={fieldError ? "workspace-name-error" : undefined}
              />
              {fieldError && (
                <p id="workspace-name-error" className="mt-1 text-xs text-destructive">
                  {fieldError}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                You&apos;ll be the owner. You can invite teammates later.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create workspace"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
