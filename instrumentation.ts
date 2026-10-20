import { reportError } from "@/lib/observability/report";

/**
 * Next.js instrumentation: captures every unhandled server error
 * (route handlers, server components, server actions) into the
 * structured error reporter, so failures are visible in the Vercel
 * runtime logs with a searchable report id.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string },
  context: { routerKind?: string; routeType?: string },
): Promise<void> {
  reportError(error, {
    route: request?.path,
    action: `${context?.routerKind ?? "unknown"}:${context?.routeType ?? "unknown"}`,
    digest: (error as { digest?: string } | null)?.digest,
  });
}
