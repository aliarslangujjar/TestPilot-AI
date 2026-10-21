/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import HomePage from "@/app/page";

afterEach(() => cleanup());

describe("landing page", () => {
  it("presents the product honestly with sign-in entry points", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { name: "Manual QA, organized. Browser QA, executed." }),
    ).toBeInTheDocument();
    const signIns = screen.getAllByRole("link", { name: /get started/i });
    expect(signIns.length).toBeGreaterThan(0);
    for (const link of signIns) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });

  it("marks unbuilt capabilities as planned, not shipped", () => {
    render(<HomePage />);
    expect(
      screen.getByText("Hosted cloud deployment (self-hosting works today)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Payments and paid plans")).toBeInTheDocument();
    const planned = screen.getAllByText("Planned");
    expect(planned.length).toBe(3);
  });

  it("links to the GitHub repository", () => {
    render(<HomePage />);
    const links = screen.getAllByRole("link", { name: /github/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toContain("github.com/aliarslangujjar/TestPilot-AI");
    }
  });
});
