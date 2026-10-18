/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { MetricCard } from "@/components/dashboard/metric-card";

afterEach(() => cleanup());

describe("MetricCard", () => {
  it("renders the label, value, and sample hint", () => {
    render(<MetricCard metric={{ id: "m", label: "Pass rate", value: "87.5%", hint: "sample" }} />);
    expect(screen.getByText("Pass rate")).toBeInTheDocument();
    expect(screen.getByText("87.5%")).toBeInTheDocument();
    expect(screen.getByText("sample")).toBeInTheDocument();
  });

  it("exposes an accessible label combining label, value, and hint", () => {
    render(
      <MetricCard
        metric={{ id: "m", label: "Total runs", value: "128", hint: "sample, last 30 days" }}
      />,
    );
    expect(screen.getByLabelText("Total runs: 128 (sample, last 30 days)")).toBeInTheDocument();
  });
});
