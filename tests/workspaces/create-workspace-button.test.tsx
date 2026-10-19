/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateWorkspaceButton } from "@/components/workspaces/create-workspace-button";

const { createWorkspaceMock, pushMock, refreshMock } = vi.hoisted(() => ({
  createWorkspaceMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: (...args: unknown[]) => createWorkspaceMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateWorkspaceButton", () => {
  it("creates a workspace and navigates to projects", async () => {
    const user = userEvent.setup();
    createWorkspaceMock.mockResolvedValue({
      ok: true,
      data: { id: "w1", name: "Acme QA", createdAt: "2026-10-18T10:00:00.000Z" },
    });

    render(<CreateWorkspaceButton />);
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Workspace name"), "Acme QA");
    await user.click(within(dialog).getByRole("button", { name: "Create workspace" }));

    expect(createWorkspaceMock).toHaveBeenCalledWith({ name: "Acme QA" });
    expect(pushMock).toHaveBeenCalledWith("/dashboard/projects");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows validation errors without calling the server", async () => {
    const user = userEvent.setup();
    render(<CreateWorkspaceButton />);
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create workspace" }));
    expect(createWorkspaceMock).not.toHaveBeenCalled();
    expect(
      await within(dialog).findByText("Workspace name must be at least 2 characters."),
    ).toBeInTheDocument();
  });
});
