/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectsManager } from "@/components/projects/projects-manager";
import type { Project } from "@schemas/project";

const WS_ID = "11111111-1111-1111-1111-111111111111";

const { listProjectsMock, setProjectArchivedMock, createProjectMock, updateProjectMock } =
  vi.hoisted(() => ({
    listProjectsMock: vi.fn(),
    setProjectArchivedMock: vi.fn(),
    createProjectMock: vi.fn(),
    updateProjectMock: vi.fn(),
  }));

vi.mock("@/lib/projects/actions", () => ({
  listProjects: (...args: unknown[]) => listProjectsMock(...args),
  setProjectArchived: (...args: unknown[]) => setProjectArchivedMock(...args),
  createProject: (...args: unknown[]) => createProjectMock(...args),
  updateProject: (...args: unknown[]) => updateProjectMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard/projects",
}));

afterEach(() => cleanup());

const SAMPLE: Project = {
  id: "33333333-3333-3333-3333-333333333333",
  workspaceId: WS_ID,
  name: "Billing API",
  description: "Covers invoicing.",
  baseUrl: "https://staging.example.com",
  isArchived: false,
  createdBy: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T12:00:00.000Z",
};

function renderManager() {
  return render(<ProjectsManager workspaceId={WS_ID} workspaceName="Acme" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  listProjectsMock.mockResolvedValue({ ok: true, data: [SAMPLE] });
});

describe("ProjectsManager", () => {
  it("shows a loading state, then the project list", async () => {
    let resolveList!: (value: unknown) => void;
    listProjectsMock.mockImplementation(() => new Promise((resolve) => (resolveList = resolve)));
    renderManager();
    expect(screen.getByLabelText("Loading projects")).toBeInTheDocument();
    await act(async () => {
      resolveList({ ok: true, data: [SAMPLE] });
    });
    expect(await screen.findByText("Billing API")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading projects")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no projects", async () => {
    listProjectsMock.mockResolvedValue({ ok: true, data: [] });
    renderManager();
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project" })).toBeInTheDocument();
  });

  it("shows an error with retry when loading fails", async () => {
    listProjectsMock.mockResolvedValue({ ok: false, error: "Database is down" });
    const user = userEvent.setup();
    renderManager();
    expect(await screen.findByRole("alert")).toHaveTextContent("Database is down");
    listProjectsMock.mockResolvedValue({ ok: true, data: [SAMPLE] });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Billing API")).toBeInTheDocument();
  });

  it("searches by name through the server action", async () => {
    const user = userEvent.setup();
    renderManager();
    expect(await screen.findByText("Billing API")).toBeInTheDocument();
    listProjectsMock.mockClear();
    listProjectsMock.mockImplementation(() => new Promise(() => {})); // stays pending
    await user.type(screen.getByLabelText("Search projects"), "bill");
    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(listProjectsMock).toHaveBeenCalledWith(
        WS_ID,
        expect.objectContaining({ search: "bill" }),
      );
    });
  });

  it("creates a project and shows a success notice", async () => {
    const user = userEvent.setup();
    const created = {
      ...SAMPLE,
      id: "44444444-4444-4444-4444-444444444444",
      name: "Search Service",
    };
    createProjectMock.mockResolvedValue({ ok: true, data: created });
    renderManager();
    expect(await screen.findByText("Billing API")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Name"), "Search Service");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(createProjectMock).toHaveBeenCalledWith(
      WS_ID,
      expect.objectContaining({ name: "Search Service" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Project “Search Service” created.",
    );
  });

  it("shows server validation errors inside the dialog", async () => {
    const user = userEvent.setup();
    createProjectMock.mockResolvedValue({
      ok: false,
      error: "A project with this name already exists in this workspace.",
    });
    renderManager();
    expect(await screen.findByText("Billing API")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Name"), "Billing API");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
  });

  it("archives a project after confirmation and shows a notice", async () => {
    const user = userEvent.setup();
    setProjectArchivedMock.mockResolvedValue({ ok: true, data: SAMPLE });
    renderManager();
    expect(await screen.findByText("Billing API")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText("Archive this project?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(setProjectArchivedMock).toHaveBeenCalledWith(WS_ID, SAMPLE.id, true);
    expect(await screen.findByRole("status")).toHaveTextContent("archived");
  });

  it("opens the detail view for a project", async () => {
    const user = userEvent.setup();
    renderManager();
    expect(await screen.findByText("Billing API")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Covers invoicing.");
    expect(dialog).toHaveTextContent("https://staging.example.com");
  });

  it("auto-opens the create dialog when autoOpenCreate is set", async () => {
    listProjectsMock.mockResolvedValue({ ok: true, data: [] });
    render(<ProjectsManager workspaceId={WS_ID} workspaceName="Acme" autoOpenCreate />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("New project");
  });

  it("does not auto-open the create dialog by default", async () => {
    renderManager();
    expect(await screen.findByText("Billing API")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
