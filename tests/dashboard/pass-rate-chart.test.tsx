/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { demoPassRateTrend } from "@/components/dashboard/demo-data";
import { PassRateChart } from "@/components/dashboard/pass-rate-chart";

afterEach(() => cleanup());

describe("PassRateChart", () => {
  it("renders an accessible chart summary stating the data is sample data", () => {
    render(<PassRateChart />);
    const chart = screen.getByRole("img");
    const label = chart.getAttribute("aria-label") ?? "";
    expect(label).toContain("Sample pass-rate trend");
    expect(label).toContain("No real tests have been executed");
  });

  it("plots one point per trend value", () => {
    const { container } = render(<PassRateChart />);
    // circles are the data points; gridlines are <line> elements
    expect(container.querySelectorAll("circle").length).toBe(demoPassRateTrend.length);
  });

  it("exposes every value in the details data table", () => {
    render(<PassRateChart />);
    const rows = screen.getAllByRole("row");
    // 1 header row + 1 thead row + one row per trend value
    const bodyRows = rows.filter((row) => row.querySelector("th[scope='row']"));
    expect(bodyRows).toHaveLength(demoPassRateTrend.length);
    expect(screen.getByText("94%")).toBeInTheDocument();
  });
});
