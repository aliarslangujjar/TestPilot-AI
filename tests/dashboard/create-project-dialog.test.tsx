/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateProjectDialog } from "@/components/dashboard/create-project-dialog";

afterEach(() => cleanup());

function openDialog(props?: Partial<React.ComponentProps<typeof CreateProjectDialog>>) {
  return render(<CreateProjectDialog open onClose={() => {}} onSubmit={() => {}} {...props} />);
}

describe("CreateProjectDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CreateProjectDialog open={false} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is an accessible modal labelled by its title", () => {
    openDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Create project");
  });

  it("rejects an empty name with an inline error", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    openDialog({ onSubmit });
    await user.click(screen.getByRole("button", { name: /^create project$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 2 characters/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a trimmed name and closes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    openDialog({ onSubmit, onClose });
    await user.type(screen.getByLabelText("Project name"), "  Storefront  ");
    await user.click(screen.getByRole("button", { name: /^create project$/i }));
    expect(onSubmit).toHaveBeenCalledWith("Storefront");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    openDialog({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the name field on open", () => {
    openDialog();
    expect(screen.getByLabelText("Project name")).toHaveFocus();
  });
});
