/**
 * Result sanitization. Step errors can embed page content, selectors, or
 * stack details; everything written back to the database is truncated,
 * control/ANSI-stripped, and free of stack traces.
 */

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g; // eslint-disable-line no-control-regex -- ESC is the point
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const MAX_ERROR_LENGTH = 500;
export const MAX_RESULT_LENGTH = 2000;

export function sanitizeError(message: unknown, maxLen = MAX_ERROR_LENGTH): string {
  const raw = message instanceof Error ? message.message : String(message ?? "");
  const cleaned = raw
    .replace(ANSI_PATTERN, "")
    .replace(CONTROL_PATTERN, "")
    // URLs inside error text lose their query/fragment (may carry tokens).
    .replace(/https?:\/\/[^\s"']+/g, (match) => stripUrlQuery(match))
    // First line only: Playwright stack blocks start after the first line.
    .split("\n")[0]
    ?.trim()
    .slice(0, maxLen);
  return cleaned && cleaned.length > 0 ? cleaned : "Step failed.";
}

export function sanitizeText(text: string, maxLen = MAX_RESULT_LENGTH): string {
  return text.replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "").trim().slice(0, maxLen);
}

/**
 * Reduce a URL to origin + path for diagnostics. Query strings and
 * fragments can carry tokens (reset links, signed parameters) that
 * must never persist in job results or be forwarded to an AI provider.
 * Unparseable values are cut at the first ? or #.
 */
export function stripUrlQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}
