/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EmptyState } from "@/components/dashboard/empty-state";

afterEach(() => cleanup());

describe("EmptyState", () => {
  it("explains the new-user state and offers the create action", () => {
    render(<EmptyState onCreate={() => {}} />);
    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
    expect(
      screen.getByText(/create your first project to start organizing test cases/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your first project" })).toBeInTheDocument();
  });

  it("calls onCreate when the CTA is clicked", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<EmptyState onCreate={onCreate} />);
    await user.click(screen.getByRole("button", { name: "Create your first project" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("is honest that demo projects are not saved", () => {
    render(<EmptyState onCreate={() => {}} />);
    expect(screen.getByText(/demo only/i)).toBeInTheDocument();
  });
});
