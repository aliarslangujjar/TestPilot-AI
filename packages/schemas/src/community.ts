import { z } from "zod";

import { testTypeSchema } from "./test-plan";

/**
 * Community template library.
 *
 * A community template is UNTRUSTED DATA: content is validated against a
 * strict schema (unknown keys rejected outright, so no script/eval/host
 * override fields can be smuggled in), scanned for executable content,
 * and re-validated on import. Imported templates become draft test
 * cases in the importer's own workspace — nothing executes, nothing is
 * shared back, and template content carries no URLs the platform would
 * fetch.
 */

export const templateLicenseSchema = z.enum(["MIT", "CC-BY-4.0", "CC0-1.0"]);

export type TemplateLicense = z.infer<typeof templateLicenseSchema>;

export const TEMPLATE_LICENSE_LABELS: Record<TemplateLicense, string> = {
  MIT: "MIT",
  "CC-BY-4.0": "CC BY 4.0 (attribution)",
  "CC0-1.0": "CC0 1.0 (public domain)",
};

export const templateAppTypeSchema = z.enum([
  "general-web-app",
  "ecommerce",
  "saas-dashboard",
  "auth",
  "rest-api",
  "content-site",
  "custom",
]);

export type TemplateAppType = z.infer<typeof templateAppTypeSchema>;

export const TEMPLATE_APP_TYPE_LABELS: Record<TemplateAppType, string> = {
  "general-web-app": "General web app",
  ecommerce: "E-commerce",
  "saas-dashboard": "SaaS dashboard",
  auth: "Authentication",
  "rest-api": "REST API",
  "content-site": "Content site",
  custom: "Custom",
};

const strictStepSchema = z
  .object({
    action: z.string().trim().min(1).max(500),
    expected: z.string().trim().min(1).max(500),
  })
  .strict();

/** One case inside a template — strict: any extra key fails validation. */
export const templateCaseSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    objective: z.string().trim().min(1).max(500),
    preconditions: z.string().trim().max(2000).default(""),
    steps: z.array(strictStepSchema).min(1).max(30),
    expectedResults: z.string().trim().min(1).max(2000),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    coverage: z.enum(["positive", "negative", "boundary"]),
    testType: testTypeSchema,
    area: z.string().trim().min(1).max(60),
    assumptions: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  })
  .strict();

export type TemplateCase = z.infer<typeof templateCaseSchema>;

export const templateContentSchema = z
  .object({
    cases: z.array(templateCaseSchema).min(1).max(50),
  })
  .strict();

export type TemplateContent = z.infer<typeof templateContentSchema>;

/** API shape of a community template (camelCase). Content only in preview. */
export const communityTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  appType: templateAppTypeSchema,
  license: templateLicenseSchema,
  tags: z.array(z.string()),
  authorUserId: z.uuid(),
  authorDisplayName: z.string(),
  caseCount: z.number().int().min(0),
  viewCount: z.number().int().min(0),
  importCount: z.number().int().min(0),
  status: z.enum(["published", "removed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CommunityTemplate = z.infer<typeof communityTemplateSchema>;

export const communityTemplateDetailSchema = communityTemplateSchema.extend({
  content: templateContentSchema,
});

export type CommunityTemplateDetail = z.infer<typeof communityTemplateDetailSchema>;

export const templateReportReasonSchema = z.enum([
  "spam",
  "malicious_content",
  "copyright",
  "inappropriate",
  "other",
]);

export type TemplateReportReason = z.infer<typeof templateReportReasonSchema>;

export const TEMPLATE_REPORT_REASON_LABELS: Record<TemplateReportReason, string> = {
  spam: "Spam or advertising",
  malicious_content: "Malicious or unsafe content",
  copyright: "Copyright violation",
  inappropriate: "Inappropriate content",
  other: "Other",
};
