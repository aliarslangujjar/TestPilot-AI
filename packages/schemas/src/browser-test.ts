import { z } from "zod";

/**
 * Browser-test specification, version 1.
 *
 * A constrained, JSON-serializable description of a browser test that a
 * future executor (Playwright worker) can run deterministically.
 *
 * Deliberately narrow on purpose:
 * - Navigation is restricted to an explicit allowlist of hosts declared in
 *   the plan. Absolute URLs outside the allowlist are rejected.
 * - Locators are accessibility-first (role, label, placeholder, text,
 *   testId). No CSS/XPath selectors, so plans can't depend on DOM internals.
 * - Actions are a closed set: goto, click, fill, and three assertions.
 * - There is NO way to express arbitrary JavaScript evaluation, shell
 *   commands, file access, or network calls. Every object is `.strict()`,
 *   so smuggling an `evaluate`/`script`/`exec` key is a validation error,
 *   not a silently ignored field.
 *
 * Versioning: `version` is a literal. Additive changes (new actions,
 * locators, options) keep parsing old plans; breaking changes bump the
 * version literal and old plans fail closed.
 */

export const BROWSER_TEST_SPEC_VERSION = "1" as const;

const MAX_STEPS = 50;
const MAX_TEXT = 2000;
const MAX_HOSTS = 10;

/** Practical subset of ARIA roles an executor can resolve. */
export const browserTestRoles = [
  "alert",
  "button",
  "cell",
  "checkbox",
  "combobox",
  "dialog",
  "form",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "main",
  "navigation",
  "option",
  "radio",
  "row",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "table",
  "tabpanel",
  "textbox",
] as const;

const roleSchema = z.enum(browserTestRoles);

/**
 * Accessible locators only. Unknown `by` values are rejected by the
 * discriminated union; unknown keys are rejected by `.strict()`.
 */
export const browserLocatorSchema = z.discriminatedUnion("by", [
  z
    .object({
      by: z.literal("role"),
      role: roleSchema,
      name: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z.object({ by: z.literal("label"), label: z.string().trim().min(1).max(200) }).strict(),
  z
    .object({
      by: z.literal("placeholder"),
      placeholder: z.string().trim().min(1).max(200),
    })
    .strict(),
  z.object({ by: z.literal("text"), text: z.string().trim().min(1).max(500) }).strict(),
  z.object({ by: z.literal("testId"), testId: z.string().trim().min(1).max(200) }).strict(),
]);

export type BrowserLocator = z.infer<typeof browserLocatorSchema>;

/** Per-step timeout. Optional; bounded so a plan can't hang an executor. */
const timeoutMsSchema = z.number().int().min(100).max(30_000);

const gotoStepSchema = z
  .object({
    action: z.literal("goto"),
    /** Absolute URL on an allowed host, or a path like "/login". */
    url: z.string().trim().min(1).max(MAX_TEXT),
    timeoutMs: timeoutMsSchema.optional(),
  })
  .strict();

const clickStepSchema = z
  .object({
    action: z.literal("click"),
    locator: browserLocatorSchema,
    timeoutMs: timeoutMsSchema.optional(),
  })
  .strict();

const fillStepSchema = z
  .object({
    action: z.literal("fill"),
    locator: browserLocatorSchema,
    value: z.string().max(MAX_TEXT),
    timeoutMs: timeoutMsSchema.optional(),
  })
  .strict();

const assertTextStepSchema = z
  .object({
    action: z.literal("assertText"),
    locator: browserLocatorSchema,
    text: z.string().trim().min(1).max(MAX_TEXT),
    exact: z.boolean().default(false),
    timeoutMs: timeoutMsSchema.optional(),
  })
  .strict();

const assertUrlStepSchema = z
  .object({
    action: z.literal("assertUrl"),
    expected: z.string().trim().min(1).max(MAX_TEXT),
    match: z.enum(["exact", "contains"]).default("exact"),
    timeoutMs: timeoutMsSchema.optional(),
  })
  .strict();

const assertStateStepSchema = z
  .object({
    action: z.literal("assertState"),
    locator: browserLocatorSchema,
    state: z.enum(["visible", "hidden", "enabled", "disabled", "checked", "unchecked"]),
    timeoutMs: timeoutMsSchema.optional(),
  })
  .strict();

/**
 * Closed action set. An unknown `action` (e.g. "evaluate", "exec",
 * "runScript") fails the discriminated union — it is rejected, never
 * ignored.
 */
export const browserTestStepSchema = z.discriminatedUnion("action", [
  gotoStepSchema,
  clickStepSchema,
  fillStepSchema,
  assertTextStepSchema,
  assertUrlStepSchema,
  assertStateStepSchema,
]);

export type BrowserTestStep = z.infer<typeof browserTestStepSchema>;

const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i, "Invalid hostname.");

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export const browserTestPlanSchema = z
  .object({
    version: z.literal(BROWSER_TEST_SPEC_VERSION),
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(200),
    description: z.string().trim().max(MAX_TEXT).default(""),
    /** Base URL the plan runs against; its host must be allowlisted. */
    baseUrl: z.string().trim().url("baseUrl must be a valid URL.").max(MAX_TEXT),
    /** Hosts navigation may target. Nothing outside this list is reachable. */
    allowedHosts: z
      .array(hostnameSchema)
      .min(1, "At least one allowed host is required.")
      .max(MAX_HOSTS, `At most ${MAX_HOSTS} allowed hosts.`),
    steps: z
      .array(browserTestStepSchema)
      .min(1, "A plan needs at least one step.")
      .max(MAX_STEPS, `At most ${MAX_STEPS} steps per plan.`),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const allowed = new Set(plan.allowedHosts.map((h) => h.toLowerCase()));

    // baseUrl must be an absolute http(s) URL with a real host. Other
    // schemes (file:, data:, javascript:) are never valid test targets,
    // and a hostless URL would silently skip the allowlist check below.
    let baseProtocol: string | null;
    try {
      baseProtocol = new URL(plan.baseUrl).protocol;
    } catch {
      baseProtocol = null;
    }
    if (baseProtocol !== "http:" && baseProtocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "baseUrl must be an http(s) URL.",
      });
    }

    const baseHost = hostOf(plan.baseUrl);
    if (!baseHost) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "baseUrl must have a host.",
      });
    } else if (!allowed.has(baseHost)) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: `baseUrl host "${baseHost}" is not in allowedHosts.`,
      });
    }

    plan.steps.forEach((step, i) => {
      if (step.action !== "goto") return;
      // Protocol-relative URLs ("//host/path") inherit the base scheme
      // at runtime and would bypass the host check (hostOf throws on
      // them without a base), so they are rejected outright.
      if (step.url.startsWith("//")) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "url"],
          message: "Protocol-relative navigation targets are not allowed.",
        });
        return;
      }
      const host = hostOf(step.url);
      if (host) {
        if (!allowed.has(host)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", i, "url"],
            message: `Navigation to "${host}" is not allowlisted.`,
          });
        }
      } else if (!step.url.startsWith("/")) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "url"],
          message: 'Relative navigation targets must start with "/".',
        });
      }
    });
  });

export type BrowserTestPlan = z.infer<typeof browserTestPlanSchema>;

export const BROWSER_TEST_LIMITS = {
  maxSteps: MAX_STEPS,
  maxHosts: MAX_HOSTS,
  maxText: MAX_TEXT,
  maxTimeoutMs: 30_000,
} as const;

export type ParseBrowserTestPlanResult =
  { ok: true; plan: BrowserTestPlan } | { ok: false; errors: string[] };

/** Parse with flattened, human-readable error messages. */
export function parseBrowserTestPlan(input: unknown): ParseBrowserTestPlanResult {
  const result = browserTestPlanSchema.safeParse(input);
  if (result.success) return { ok: true, plan: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    }),
  };
}
