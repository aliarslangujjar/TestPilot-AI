"use client";

import { useEffect } from "react";

/**
 * Route-segment error boundary. Reports the error through the beacon
 * (best effort — the report must never mask the original failure) and
 * offers a retry. Shows the framework digest, which matches the
 * server-side log entry.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch("/api/error-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest,
        route: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {
      // Best effort only.
    });
  }, [error]);

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The error was reported automatically. You can try again — if it keeps happening, note the
        reference below when asking for help.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Try again
      </button>
    </main>
  );
}
