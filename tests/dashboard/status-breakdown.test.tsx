/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { demoStatusCounts } from "@/components/dashboard/demo-data";
import { StatusBreakdown } from "@/components/dashboard/status-breakdown";

afterEach(() => cleanup());

describe("StatusBreakdown", () => {
  it("lists passed, failed, and skipped counts from the demo data", () => {
    render(<StatusBreakdown />);
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText(`${demoStatusCounts.passed} · 88%`)).toBeInTheDocument();
    expect(screen.getByText(`${demoStatusCounts.failed} · 9%`)).toBeInTheDocument();
    expect(screen.getByText(`${demoStatusCounts.skipped} · 4%`)).toBeInTheDocument();
  });

  it("provides a text summary of the chart for assistive tech", () => {
    render(<StatusBreakdown />);
    const graphic = screen.getByRole("img");
    expect(graphic).toHaveAttribute("aria-label", expect.stringContaining("Passed 112 (88%)"));
    expect(graphic.getAttribute("aria-label")).toContain("Failed 11 (9%)");
    expect(graphic.getAttribute("aria-label")).toContain("Skipped 5 (4%)");
  });

  it("is headed by a labeled section", () => {
    render(<StatusBreakdown />);
    expect(screen.getByRole("heading", { name: /run outcomes \(sample\)/i })).toBeInTheDocument();
  });
});
