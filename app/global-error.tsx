"use client";

/**
 * Root error boundary — renders its own document because the root
 * layout itself may be what failed. Plain inline styles (the app's CSS
 * pipeline is not guaranteed to be available here). Reports through
 * the beacon best-effort, mirroring app/error.tsx.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (typeof window !== "undefined") {
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
  }

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <h1 style={{ fontSize: "1.25rem" }}>Something went wrong</h1>
        <p style={{ color: "#a3a3a3", fontSize: "0.875rem" }}>
          The application hit an unexpected error. It was reported automatically.
          {error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            borderRadius: "0.375rem",
            border: "1px solid #404040",
            background: "#171717",
            color: "#fafafa",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
