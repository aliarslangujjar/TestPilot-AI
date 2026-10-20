import type { TestType } from "@schemas/test-plan";

/**
 * Test-plan templates for common application types. A template seeds the
 * interactive generation form (test types, coverage areas) and steers the
 * model with app-specific guidance. The user can adjust everything before
 * generating — a template is a starting point, not a straitjacket.
 *
 * Plain module: safe to import from client components.
 */

export interface PlanTemplate {
  key: string;
  name: string;
  description: string;
  defaultTestTypes: TestType[];
  defaultCoverageAreas: string[];
  /** Extra instructions appended to the generation prompt. */
  promptGuidance: string;
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: "general-web-app",
    name: "General web app",
    description: "Pages, forms, and navigation of a typical web application.",
    defaultTestTypes: ["functional", "negative", "boundary"],
    defaultCoverageAreas: ["Navigation", "Forms & validation", "Content display", "Error handling"],
    promptGuidance:
      "Cover page navigation, form validation (required fields, formats, error messages), and graceful error handling for failed loads.",
  },
  {
    key: "ecommerce",
    name: "E-commerce",
    description: "Catalog, cart, checkout, payments, and order management.",
    defaultTestTypes: ["functional", "negative", "boundary", "security"],
    defaultCoverageAreas: [
      "Product catalog",
      "Cart",
      "Checkout",
      "Payments",
      "Accounts & orders",
      "Search & filtering",
    ],
    promptGuidance:
      "Cover the full purchase funnel: catalog browsing, cart mutations (add/remove/quantity), checkout validation, discount codes, and order history. For payments, describe what the tester observes in the UI and order status — never claim a real charge is executed or verified.",
  },
  {
    key: "saas-dashboard",
    name: "SaaS dashboard",
    description: "Data dashboards, reports, roles, settings, and notifications.",
    defaultTestTypes: ["functional", "negative", "boundary", "accessibility"],
    defaultCoverageAreas: [
      "Dashboard widgets",
      "Reports & exports",
      "Users & roles",
      "Settings",
      "Notifications",
    ],
    promptGuidance:
      "Cover data display with different data volumes (empty, few, many), filtering and date ranges, role-based access to admin areas, and export formats. Include keyboard navigation and screen-reader landmarks where relevant.",
  },
  {
    key: "auth",
    name: "Authentication",
    description: "Sign up, sign in, password reset, sessions, and MFA.",
    defaultTestTypes: ["functional", "negative", "boundary", "security"],
    defaultCoverageAreas: ["Sign up", "Sign in", "Password reset", "Sessions", "MFA"],
    promptGuidance:
      "Cover credential validation, lockout after repeated failures, password-reset token expiry, session persistence across reloads, and sign-out clearing access. Describe observable behavior only — never require the tester to inspect tokens or secrets.",
  },
  {
    key: "rest-api",
    name: "REST API",
    description: "Endpoints, contracts, validation, auth, and pagination.",
    defaultTestTypes: ["functional", "negative", "boundary", "security"],
    defaultCoverageAreas: [
      "Endpoints & contracts",
      "Input validation",
      "Auth & authorization",
      "Pagination & filtering",
      "Rate limiting",
    ],
    promptGuidance:
      "These are manual API tests run with a REST client (e.g. Postman or curl). Cover happy-path responses, validation errors (missing/invalid fields), authentication failures, authorization boundaries between users, pagination edges, and rate-limit responses. Do not claim any automated performance or load testing.",
  },
  {
    key: "content-site",
    name: "Content site",
    description: "Publishing, media, search, and responsive layout.",
    defaultTestTypes: ["functional", "boundary", "accessibility"],
    defaultCoverageAreas: ["Content publishing", "Media", "Search", "Responsive layout"],
    promptGuidance:
      "Cover content creation and editing flows, media upload constraints (file types, sizes), search relevance with edge queries, and layout behavior at common breakpoints. Include alt text and heading structure checks.",
  },
];

export function listPlanTemplates(): PlanTemplate[] {
  return PLAN_TEMPLATES;
}

export function getPlanTemplate(key: string): PlanTemplate | null {
  return PLAN_TEMPLATES.find((t) => t.key === key) ?? null;
}
