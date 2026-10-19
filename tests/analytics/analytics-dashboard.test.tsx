/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import type { AnalyticsData } from "@/lib/analytics/actions";

const { getAnalyticsMock } = vi.hoisted(() => ({
  getAnalyticsMock: vi.fn(),
}));

vi.mock("@/lib/analytics/actions", () => ({
  getAnalytics: (...args: unknown[]) => getAnalyticsMock(...args),
}));

afterEach(() => cleanup());

const WS_ID = "11111111-1111-4111-8111-111111111111";

const DATA: AnalyticsData = {
  range: 15,
  totals: {
    projects: 2,
    suites: 3,
    testCases: 10,
    draftCases: 4,
    runs: 5,
    executions: 8,
    pass: 6,
    fail: 1,
    blocked: 1,
    skipped: 0,
    passRate: 75,
  },
  daily: [
    {
      date: "2026-10-18",
      label: "Oct 18",
      pass: 6,
      fail: 1,
      blocked: 1,
      skipped: 0,
      total: 8,
      passRate: 75,
    },
    {
      date: "2026-10-19",
      label: "Oct 19",
      pass: 1,
      fail: 1,
      blocked: 0,
      skipped: 0,
      total: 2,
      passRate: 50,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getAnalyticsMock.mockResolvedValue({ ok: true, data: DATA });
});

describe("AnalyticsDashboard", () => {
  it("renders metric cards and charts from real data", async () => {
    render(<AnalyticsDashboard workspaceId={WS_ID} workspaceName="Acme QA" />);
    expect(await screen.findByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("Global pass rate")).toBeInTheDocument();
    const passCard = screen.getByText("Global pass rate").closest("div")!;
    expect(passCard.textContent).toContain("75%");
    expect(screen.getByText("Pass rate by day")).toBeInTheDocument();
    expect(screen.getByText("Results by day")).toBeInTheDocument();
    expect(getAnalyticsMock).toHaveBeenCalledWith(WS_ID, 15);
  });

  it("reloads with the selected range", async () => {
    const user = userEvent.setup();
    render(<AnalyticsDashboard workspaceId={WS_ID} workspaceName="Acme QA" />);
    expect(await screen.findByText("Analytics")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Range"), "30");
    expect(getAnalyticsMock).toHaveBeenLastCalledWith(WS_ID, 30);
  });

  it("shows an error with retry", async () => {
    getAnalyticsMock.mockResolvedValue({ ok: false, error: "Nope." });
    render(<AnalyticsDashboard workspaceId={WS_ID} workspaceName="Acme QA" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
  });
});
