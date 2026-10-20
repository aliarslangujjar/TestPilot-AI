/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TestPlansManager } from "@/components/test-plans/test-plans-manager";
import type { StoredTestPlan } from "@schemas/test-plan";

vi.mock("@/lib/test-plans/plans", () => ({
  convertTestPlan: vi.fn(),
  deleteTestPlan: vi.fn(),
  generateAndStoreTestPlan: vi.fn(),
  getPlanGenerationEstimate: vi.fn(),
  listTestPlans: vi.fn(),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const PLAN: StoredTestPlan = {
  id: "33333333-3333-4333-8333-333333333333",
  workspaceId: WS,
  projectId: PROJECT,
  name: "Checkout plan",
  templateKey: "ecommerce",
  sourceKind: "user_story",
  sourceText: "As a shopper I want to check out with a card.",
  settings: {
    testTypes: ["functional", "security"],
    coverageAreas: ["Checkout"],
    priorityStrategy: "risk_first",
    maxCases: 12,
  },
  plan: {
    summary: "Covers checkout end to end.",
    cases: [
      {
        title: "Complete a purchase",
        objective: "Verifies checkout completes.",
        preconditions: "",
        steps: [{ action: "Pay", expected: "Order confirmed." }],
        expectedResults: "Order confirmed.",
        priority: "high",
        coverage: "positive",
        testType: "functional",
        area: "Checkout",
        assumptions: [],
      },
    ],
  },
  model: "gpt-4o-mini",
  status: "draft",
  suiteId: null,
  createdBy: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

afterEach(() => cleanup());

function renderManager(plans: StoredTestPlan[] = [PLAN]) {
  return render(
    <TestPlansManager
      workspaceId={WS}
      projectId={PROJECT}
      projectName="Demo"
      initialPlans={plans}
      initialError={null}
    />,
  );
}

describe("TestPlansManager", () => {
  it("lists stored plans with template, case count, and status", () => {
    renderManager();
    expect(screen.getByText("Checkout plan")).toBeInTheDocument();
    expect(screen.getByText("E-commerce")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
  });

  it("shows an empty state explaining the workflow when there are no plans", () => {
    renderManager([]);
    expect(screen.getByText(/No test plans yet/)).toBeInTheDocument();
  });

  it("template selection seeds the form's test types and coverage areas", () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "New test plan" }));
    // Default template (general web app) areas.
    expect(screen.getByText("Forms & validation")).toBeInTheDocument();
    // Switch to E-commerce.
    fireEvent.click(screen.getByRole("button", { name: /E-commerce/ }));
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
    const security = screen.getByRole("checkbox", { name: "Security" }) as HTMLInputElement;
    expect(security.checked).toBe(true);
    const accessibility = screen.getByRole("checkbox", {
      name: "Accessibility",
    }) as HTMLInputElement;
    expect(accessibility.checked).toBe(false);
  });

  it("opens the plan detail grouped by area with the convert section", () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Checkout plan" }));
    expect(screen.getByText("Covers checkout end to end.")).toBeInTheDocument();
    expect(screen.getByText("Complete a purchase")).toBeInTheDocument();
    expect(screen.getByText("Convert into test cases")).toBeInTheDocument();
    expect(screen.getByText(/not executed coverage/)).toBeInTheDocument();
  });

  it("lets the user toggle a test type off", () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "New test plan" }));
    const security = screen.getByRole("checkbox", { name: "Security" }) as HTMLInputElement;
    // general-web-app defaults do not include security.
    expect(security.checked).toBe(false);
    fireEvent.click(security);
    expect(security.checked).toBe(true);
  });
});
