import { Button } from "@/components/ui/button";

/**
 * New-user empty state: shown when the workspace has no projects yet.
 */
export function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      aria-labelledby="empty-state-heading"
      className="mx-auto flex max-w-md flex-col items-center rounded-lg border bg-card px-6 py-16 text-center shadow-sm"
    >
      <div
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-muted"
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      </div>
      <h2 id="empty-state-heading" className="mt-5 text-xl font-semibold">
        No projects yet
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Create your first project to start organizing test cases. Runs you trigger later will appear
        on your dashboard.
      </p>
      <Button onClick={onCreate} className="mt-6">
        Create your first project
      </Button>
      <p className="mt-4 text-xs text-muted-foreground">
        Demo only — projects are kept in memory and are not saved.
      </p>
    </section>
  );
}
