import { randomUUID } from "node:crypto";

import type { z } from "zod";

/**
 * Demo mode (AI_DEMO_MODE=true): deterministic, locally generated
 * sample output for any structured AI feature — NO provider call, NO
 * API key, NO cost. Output is built to satisfy the caller's zod schema
 * and is always labelled demo content in its text fields, so it can
 * never be mistaken for real model output.
 *
 * Values are derived from the schema's shape (zod v4 defs): enums take
 * their first option, strings get demo text (uuid/email/datetime
 * formats get valid values), arrays get one item, numbers a safe
 * mid-range value. The service re-parses the result with the caller's
 * schema before returning it, so a schema this generator cannot satisfy
 * fails loudly instead of leaking invalid data.
 */

interface ZodDefLike {
  type?: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: unknown;
  entries?: Record<string, unknown>;
  values?: unknown;
  value?: unknown;
  format?: string;
  checks?: Array<{ def?: { format?: string }; _zod?: { def?: { format?: string } } }>;
}

function isIntSchema(def: ZodDefLike): boolean {
  if (def.format === "int" || def.format === "safeint") return true;
  return (def.checks ?? []).some((check) => {
    const format = check.def?.format ?? check._zod?.def?.format;
    return format === "int" || format === "safeint";
  });
}

function defOf(schema: z.ZodType): ZodDefLike {
  const zodDef = (schema as unknown as { _zod?: { def?: ZodDefLike } })._zod?.def;
  const plainDef = (schema as unknown as { def?: ZodDefLike }).def;
  return zodDef ?? plainDef ?? {};
}

function demoString(def: ZodDefLike, key?: string): string {
  switch (def.format) {
    case "uuid":
    case "guid":
      return randomUUID();
    case "email":
      return "demo@example.com";
    case "datetime":
    case "date-time":
      return new Date().toISOString();
    case "url":
    case "uri":
      return "https://example.com/demo";
    default:
      return key ? `Demo ${key} (sample content)` : "Demo sample content";
  }
}

export function buildDemoValue(schema: z.ZodType, key?: string): unknown {
  const def = defOf(schema);

  switch (def.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [field, fieldSchema] of Object.entries(def.shape ?? {})) {
        out[field] = buildDemoValue(fieldSchema, field);
      }
      return out;
    }
    case "array":
      return def.element ? [buildDemoValue(def.element, key)] : [];
    case "enum": {
      // zod v4: enum values live in def.entries ({ value: value }).
      if (def.entries) {
        const values = Object.values(def.entries);
        return values.length > 0 ? values[0] : "demo";
      }
      const options = def.options as unknown[] | undefined;
      return options && options.length > 0 ? options[0] : "demo";
    }
    case "union": {
      const options = def.options as z.ZodType[] | undefined;
      const first = options && options.length > 0 ? options[0] : undefined;
      return first ? buildDemoValue(first, key) : null;
    }
    case "literal":
      return def.value ?? (def.values as unknown[] | undefined)?.[0] ?? null;
    case "string":
      return demoString(def, key);
    case "number":
      return isIntSchema(def) ? 1 : 0.5;
    case "boolean":
      return true;
    case "date":
      return new Date();
    case "record":
      return {};
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
      return def.innerType ? buildDemoValue(def.innerType, key) : undefined;
    case "null":
      return null;
    case "any":
    case "unknown":
      return "Demo sample content";
    default:
      return "Demo sample content";
  }
}

/** Build a demo object and validate it against the caller's schema. */
export function buildDemoObject<T>(schema: z.ZodType<T>): T {
  const candidate = buildDemoValue(schema);
  return schema.parse(candidate);
}
