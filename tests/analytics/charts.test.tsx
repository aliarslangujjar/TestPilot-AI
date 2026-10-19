/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PassRateChart } from "@/components/analytics/pass-rate-chart";
import { ResultsChart } from "@/components/analytics/results-chart";
import type { DailyPoint } from "@schemas/analytics";

afterEach(() => cleanup());

const DAILY: DailyPoint[] = [
  {
    date: "2026-10-17",
    label: "Oct 17",
    pass: 2,
    fail: 1,
    blocked: 0,
    skipped: 0,
    total: 3,
    passRate: 67,
  },
  {
    date: "2026-10-18",
    label: "Oct 18",
    pass: 0,
    fail: 0,
    blocked: 0,
    skipped: 0,
    total: 0,
    passRate: null,
  },
  {
    date: "2026-10-19",
    label: "Oct 19",
    pass: 1,
    fail: 0,
    blocked: 0,
    skipped: 1,
    total: 2,
    passRate: 50,
  },
];

describe("PassRateChart", () => {
  it("renders the line and a data-table fallback", () => {
    render(<PassRateChart daily={DAILY} />);
    expect(screen.getByRole("img", { name: /pass rate by day/i })).toBeInTheDocument();
    // Null days are shown as "—", never as 0%.
    const table = screen.getByText("View pass-rate data as a table").closest("details")!;
    expect(table.textContent).toContain("—");
    expect(table.textContent).toContain("67%");
  });
});

describe("ResultsChart", () => {
  it("renders stacked bars with a legend and data-table fallback", () => {
    render(<ResultsChart daily={DAILY} />);
    expect(screen.getByRole("img", { name: /daily execution results/i })).toBeInTheDocument();
    for (const label of ["Passed", "Failed", "Blocked", "Skipped"]) {
      expect(screen.getByText(label, { selector: "span" })).toBeInTheDocument();
    }
    const table = screen.getByText("View daily results as a table").closest("details")!;
    expect(table.textContent).toContain("Oct 17");
  });
});
