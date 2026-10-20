import { templateContentSchema, type TemplateContent } from "@schemas/community";

/**
 * Community template content validation — templates are UNTRUSTED DATA.
 *
 * Three layers, all must pass (used at publish time AND again at import
 * time, since stored content is never trusted):
 *
 * 1. Strict schema: unknown keys anywhere are rejected, so fields like
 *    `script`, `eval`, `baseUrl`, or `allowedHosts` cannot be smuggled
 *    into a template to influence execution or URL restrictions.
 * 2. Executable-content scan: text fields must not contain script or
 *    shell constructs (javascript: URIs, <script>, page.evaluate,
 *    child_process, curl|sh, process.env, ...).
 * 3. URL restrictions: any URL written in the text must be http(s),
 *    must not embed credentials, and must not point at loopback,
 *    private, link-local, or metadata hosts — the same destinations the
 *    browser worker refuses.
 */

const EXECUTABLE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /javascript\s*:/i, label: "javascript: URI" },
  { pattern: /data\s*:\s*text\/html/i, label: "data:text/html URI" },
  { pattern: /<\s*script/i, label: "<script> tag" },
  { pattern: /page\.evaluate/i, label: "page.evaluate" },
  { pattern: /child_process/i, label: "child_process" },
  { pattern: /\beval\s*\(/, label: "eval()" },
  { pattern: /\bexec\s*\(/, label: "exec()" },
  { pattern: /process\.env/i, label: "process.env" },
  { pattern: /\|\s*(sh|bash|zsh)\b/i, label: "pipe to shell" },
  { pattern: /\brm\s+-rf\b/i, label: "rm -rf" },
  { pattern: /powershell/i, label: "powershell" },
];

function isForbiddenHost(hostname: string): boolean {
  // WHATWG URL keeps brackets on IPv6 literals ("[::1]"); strip them or
  // every IPv6 comparison below silently misses.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host === "metadata.google.internal") {
    return true;
  }
  if (host.includes(":")) {
    // IPv6 literal: loopback, link-local, or unique-local ranges.
    if (
      host === "::1" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return true;
    }
    // IPv4-mapped IPv6: judge the embedded IPv4. WHATWG serialization
    // renders it either dotted ("::ffff:127.0.0.1") or as two hex
    // groups ("::ffff:7f00:1") depending on the input form.
    const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted?.[1]) return isForbiddenHost(mappedDotted[1]);
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex?.[1] && mappedHex[2]) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      return isForbiddenHost(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    return false;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 10) return true; // loopback / private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 0) return true;
  }
  return false;
}

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+|\b[a-z][a-z0-9+.-]*:[^\s"'<>]+/gi;

function findUrlViolation(text: string): string | null {
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return `Unparseable URL-like text: ${raw.slice(0, 60)}`;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `Only http(s) URLs are allowed in templates (found ${url.protocol}//).`;
    }
    if (url.username || url.password) {
      return "URLs with embedded credentials are not allowed in templates.";
    }
    if (isForbiddenHost(url.hostname)) {
      return `URL host is not allowed in templates: ${url.hostname}`;
    }
  }
  return null;
}

function allTextFields(content: TemplateContent): string[] {
  const texts: string[] = [];
  for (const c of content.cases) {
    texts.push(c.title, c.objective, c.preconditions, c.expectedResults, c.area, ...c.assumptions);
    for (const s of c.steps) texts.push(s.action, s.expected);
  }
  return texts;
}

export type TemplateValidation =
  { ok: true; content: TemplateContent } | { ok: false; error: string };

export function validateTemplateContent(raw: unknown): TemplateValidation {
  const parsed = templateContentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Template content failed schema validation.",
    };
  }
  const content = parsed.data;

  for (const text of allTextFields(content)) {
    for (const { pattern, label } of EXECUTABLE_PATTERNS) {
      if (pattern.test(text)) {
        return {
          ok: false,
          error: `Template content contains forbidden executable content (${label}).`,
        };
      }
    }
    const violation = findUrlViolation(text);
    if (violation) return { ok: false, error: violation };
  }

  return { ok: true, content };
}
