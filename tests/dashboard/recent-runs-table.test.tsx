/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { demoRecentRuns } from "@/components/dashboard/demo-data";
import { RecentRunsTable } from "@/components/dashboard/recent-runs-table";

afterEach(() => cleanup());

describe("RecentRunsTable", () => {
  it("renders one row per sample run with a text status badge", () => {
    render(<RecentRunsTable />);
    const table = screen.getByRole("table");
    const bodyRows = within(table)
      .getAllByRole("row")
      .filter((row) => row.querySelector("th[scope='row']"));
    expect(bodyRows).toHaveLength(demoRecentRuns.length);
    expect(screen.getByText("Checkout flow")).toBeInTheDocument();
    // status is text, never color-only — assert exact badge counts
    expect(screen.getAllByText("Passed")).toHaveLength(3);
    expect(screen.getAllByText("Failed")).toHaveLength(2);
    expect(screen.getAllByText("Skipped")).toHaveLength(1);
  });

  it("labels the table as sample data in its caption", () => {
    render(<RecentRunsTable />);
    expect(
      screen.getByText(
        "Sample list of recent test runs. No real browser tests have been executed.",
      ),
    ).toBeInTheDocument();
  });

  it("uses proper column headers", () => {
    render(<RecentRunsTable />);
    for (const name of ["Run", "Project", "Status", "Duration", "Started"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });
});
