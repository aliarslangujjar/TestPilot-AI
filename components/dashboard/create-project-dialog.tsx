import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

/**
 * Accessible modal dialog for creating a project (demo: kept in memory).
 * - role="dialog" + aria-modal, labelled by the title
 * - Escape closes, overlay click closes
 * - focus moves to the input on open and returns to the trigger on close
 * - basic focus trap while open; background scroll locked
 */
export function CreateProjectDialog({ open, onClose, onSubmit }: CreateProjectDialogProps) {
  const titleId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Project name must be at least 2 characters.");
      inputRef.current?.focus();
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-lg border bg-card p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Create project
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Demo only — the project is kept in memory and is not saved anywhere.
        </p>
        <form onSubmit={handleSubmit} className="mt-4" noValidate>
          <label htmlFor="project-name" className="text-sm font-medium">
            Project name
          </label>
          <input
            ref={inputRef}
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder="e.g. Storefront"
            autoComplete="off"
            className={cn(
              "mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              error ? "border-destructive" : "border-input",
            )}
          />
          {error && (
            <p id={errorId} role="alert" className="mt-1.5 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create project</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
