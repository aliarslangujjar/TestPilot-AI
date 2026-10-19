"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal accessible dialog: overlay click and Escape close it, and focus
 * moves to the dialog on open.
 */
export function Dialog({
  title,
  onClose,
  children,
  labelledBy,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy: string;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          "w-full rounded-lg border bg-card p-6 shadow-lg",
          "focus-visible:outline-none",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <h2 id={labelledBy} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
