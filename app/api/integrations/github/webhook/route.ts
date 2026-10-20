import { handleGitHubWebhook } from "@/lib/github/webhook";

/**
 * GitHub webhook receiver for the Actions integration.
 *
 * Authenticity comes entirely from the HMAC signature check inside the
 * handler (per-integration secret) — this route is intentionally not
 * session-protected (proxy.ts only gates /dashboard/* and
 * /reset-password). The raw body is required for signature
 * verification, so it is read as text before any parsing.
 */
export const dynamic = "force-dynamic";

/** Webhook payloads are small JSON documents; cap the accepted body. */
const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  const result = await handleGitHubWebhook({
    rawBody,
    signature: request.headers.get("x-hub-signature-256"),
    deliveryId: request.headers.get("x-github-delivery"),
    event: request.headers.get("x-github-event"),
  });
  return Response.json(result.body, { status: result.status });
}
