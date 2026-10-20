/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DashboardNav } from "@/components/dashboard-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/projects",
}));

afterEach(() => cleanup());

describe("DashboardNav", () => {
  it("marks the current section and links all sections", () => {
    render(<DashboardNav />);
    const projects = screen.getByRole("link", { name: "Projects" });
    const analytics = screen.getByRole("link", { name: "Analytics" });
    expect(projects).toHaveAttribute("href", "/dashboard/projects");
    expect(projects).toHaveAttribute("aria-current", "page");
    expect(analytics).toHaveAttribute("href", "/dashboard");
    expect(analytics).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "Profile" })).not.toBeInTheDocument();
  });
});
