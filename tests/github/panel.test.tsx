/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GitHubIntegrationPanel } from "@/components/github/github-integration-panel";
import type { GitHubIntegration } from "@schemas/github";

const { saveMock, dispatchMock, listDispatchesMock, toggleMock, deleteMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  dispatchMock: vi.fn(),
  listDispatchesMock: vi.fn(),
  toggleMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("@/lib/github/actions", () => ({
  saveGitHubIntegration: (...args: unknown[]) => saveMock(...args),
  dispatchGitHubWorkflow: (...args: unknown[]) => dispatchMock(...args),
  listGitHubWorkflowDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  setGitHubIntegrationEnabled: (...args: unknown[]) => toggleMock(...args),
  deleteGitHubIntegration: (...args: unknown[]) => deleteMock(...args),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const INTEGRATION: GitHubIntegration = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: PROJECT,
  repoOwner: "acme",
  repoName: "shop",
  workflowFile: "qa.yml",
  defaultRef: "main",
  enabled: true,
  hasToken: true,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listDispatchesMock.mockResolvedValue({ ok: true, data: [] });
  dispatchMock.mockResolvedValue({
    ok: true,
    data: {
      id: "d1",
      status: "queued",
      conclusion: null,
      githubRunId: null,
      githubRunUrl: null,
      ref: "main",
      error: null,
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    },
  });
});

afterEach(() => cleanup());

describe("GitHubIntegrationPanel", () => {
  it("connects a repository and shows the one-time webhook secret", async () => {
    saveMock.mockResolvedValue({
      ok: true,
      data: { integration: INTEGRATION, webhookSecret: "whsec_once" },
    });
    render(
      <GitHubIntegrationPanel
        workspaceId={WS}
        projectId={PROJECT}
        projectName="Shop"
        initialIntegration={null}
        initialDispatches={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Repository owner"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Repository name"), { target: { value: "shop" } });
    fireEvent.change(screen.getByLabelText(/Fine-grained access token/), {
      target: { value: "github_pat_x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect repository" }));
    await waitFor(() =>
      expect(screen.getByText(/Finish the webhook setup in GitHub/)).toBeInTheDocument(),
    );
    const secret = screen.getByLabelText(/Webhook secret/) as HTMLInputElement;
    expect(secret.value).toBe("whsec_once");
    expect(saveMock).toHaveBeenCalledWith(
      WS,
      PROJECT,
      expect.objectContaining({ repoOwner: "acme", repoName: "shop", token: "github_pat_x" }),
    );
  });

  it("dispatches with the entered inputs and shows the queued notice", async () => {
    render(
      <GitHubIntegrationPanel
        workspaceId={WS}
        projectId={PROJECT}
        projectName="Shop"
        initialIntegration={INTEGRATION}
        initialDispatches={[]}
      />,
    );
    expect(screen.getByText(/token stored \(encrypted\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Input name 1"), { target: { value: "suite" } });
    fireEvent.change(screen.getByLabelText("Input value 1"), { target: { value: "smoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispatch workflow" }));
    await waitFor(() =>
      expect(dispatchMock).toHaveBeenCalledWith(WS, PROJECT, { inputs: { suite: "smoke" } }),
    );
    await waitFor(() => expect(screen.getByText(/Workflow dispatch sent/)).toBeInTheDocument());
  });

  it("renders recent dispatches with a GitHub link", () => {
    render(
      <GitHubIntegrationPanel
        workspaceId={WS}
        projectId={PROJECT}
        projectName="Shop"
        initialIntegration={INTEGRATION}
        initialDispatches={[
          {
            id: "d9",
            status: "completed",
            conclusion: "success",
            githubRunId: 4242,
            githubRunUrl: "https://github.com/acme/shop/actions/runs/4242",
            ref: "main",
            error: null,
            createdAt: "2026-10-20T00:00:00.000Z",
            updatedAt: "2026-10-20T00:05:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByText(/completed · success/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View in GitHub" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/shop/actions/runs/4242");
  });
});
