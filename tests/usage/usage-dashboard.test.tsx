/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { UsageDashboard } from "@/components/usage/usage-dashboard";
import type { UsageSnapshot } from "@schemas/usage";

const SNAPSHOT: UsageSnapshot = {
  periodStart: "2026-10-01",
  periodEnd: "2026-11-01",
  limits: { aiCalls: 200, browserRuns: 100, executionSeconds: 3600, storageBytes: 524288000 },
  usage: { aiCalls: 200, browserRuns: 25, executionSeconds: 1800, storageBytes: 1048576 },
  history: [
    {
      periodStart: "2026-09-01",
      usage: { aiCalls: 10, browserRuns: 2, executionSeconds: 60, storageBytes: 0 },
    },
  ],
};

describe("UsageDashboard", () => {
  it("shows usage against limits, flags the exhausted resource, and lists history", () => {
    render(<UsageDashboard snapshot={SNAPSHOT} />);
    expect(screen.getByRole("progressbar", { name: "AI calls" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "AI calls" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByText(/200 \/ 200 \(100%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Limit reached for this period/)).toBeInTheDocument();
    expect(screen.getByText(/25 \/ 100 \(25%\)/)).toBeInTheDocument();
    expect(screen.getByText("Previous periods")).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.getByText(/no per-user breakdown is stored/)).toBeInTheDocument();
  });
});
