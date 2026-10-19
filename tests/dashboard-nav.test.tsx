/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DashboardNav } from "@/components/dashboard-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/projects",
}));

afterEach(() => cleanup());

describe("DashboardNav", () => {
  it("marks the current section and links both sections", () => {
    render(<DashboardNav />);
    const projects = screen.getByRole("link", { name: "Projects" });
    const overview = screen.getByRole("link", { name: "Overview" });
    expect(projects).toHaveAttribute("href", "/dashboard/projects");
    expect(projects).toHaveAttribute("aria-current", "page");
    expect(overview).toHaveAttribute("href", "/dashboard");
    expect(overview).not.toHaveAttribute("aria-current");
  });
});
