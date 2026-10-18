/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Dashboard } from "@/components/dashboard/dashboard";
import { DEMO_NOTICE } from "@/components/dashboard/demo-data";

afterEach(() => cleanup());

describe("Dashboard", () => {
  it("states up front that all data is sample data and no real tests ran", () => {
    render(<Dashboard />);
    expect(screen.getByText(DEMO_NOTICE)).toBeInTheDocument();
  });

  it("shows the sample dashboard by default with all sections", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pass rate: 87.5% (sample, last 30 days)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /run outcomes \(sample\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /pass-rate trend/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent runs \(sample\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("previews the new-user empty state via the scenario toggle", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: "New-user empty state" }));
    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("creates a project from the empty state and returns to the dashboard with a confirmation", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: "New-user empty state" }));
    await user.click(screen.getByRole("button", { name: "Create your first project" }));

    await user.type(screen.getByLabelText("Project name"), "Acme Web");
    await user.click(screen.getByRole("button", { name: /^create project$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      'Project "Acme Web" created (demo — not saved).',
    );
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});
