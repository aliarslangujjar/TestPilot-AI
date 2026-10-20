/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CommunityLibrary } from "@/components/community/community-library";
import type { CommunityTemplate, CommunityTemplateDetail } from "@schemas/community";

const {
  listMock,
  getMock,
  importMock,
  reportMock,
  unpublishMock,
  deleteMock,
  listPlansActionsMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
  importMock: vi.fn(),
  reportMock: vi.fn(),
  unpublishMock: vi.fn(),
  deleteMock: vi.fn(),
  listPlansActionsMock: vi.fn(),
}));

vi.mock("@/lib/community/actions", () => ({
  listCommunityTemplates: (...args: unknown[]) => listMock(...args),
  getCommunityTemplate: (...args: unknown[]) => getMock(...args),
  importCommunityTemplate: (...args: unknown[]) => importMock(...args),
  reportCommunityTemplate: (...args: unknown[]) => reportMock(...args),
  unpublishCommunityTemplate: (...args: unknown[]) => unpublishMock(...args),
  deleteCommunityTemplate: (...args: unknown[]) => deleteMock(...args),
  listMyCommunityTemplates: (...args: unknown[]) => listPlansActionsMock(...args),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";
const MINE = "88888888-8888-4888-8888-888888888888";

const BASE: CommunityTemplate = {
  id: TEMPLATE,
  name: "Checkout basics",
  description: "Core checkout coverage",
  appType: "ecommerce",
  license: "CC-BY-4.0",
  tags: ["checkout"],
  authorUserId: "66666666-6666-4666-8666-666666666666",
  authorDisplayName: "Ali QA",
  caseCount: 1,
  viewCount: 2,
  importCount: 0,
  status: "published",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

const DETAIL: CommunityTemplateDetail = {
  ...BASE,
  content: {
    cases: [
      {
        title: "Checkout with a valid card",
        objective: "Verify the happy-path checkout",
        preconditions: "Signed in",
        steps: [{ action: "Open checkout", expected: "Form loads" }],
        expectedResults: "Order placed",
        priority: "high",
        coverage: "positive",
        testType: "functional",
        area: "Checkout",
        assumptions: [],
      },
    ],
  },
};

const MY_TEMPLATE: CommunityTemplate = { ...BASE, id: MINE, name: "My auth suite" };

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({ ok: true, data: [BASE] });
  getMock.mockResolvedValue({ ok: true, data: DETAIL });
  importMock.mockResolvedValue({ ok: true, data: { suiteId: "s1", caseCount: 1 } });
  reportMock.mockResolvedValue({ ok: true, data: { reported: true } });
  unpublishMock.mockResolvedValue({ ok: true, data: { unpublished: true } });
  deleteMock.mockResolvedValue({ ok: true, data: { deleted: true } });
});

afterEach(() => cleanup());

function renderLibrary(mine: CommunityTemplate[] = []) {
  return render(
    <CommunityLibrary
      workspaceId={WS}
      initialTemplates={[BASE]}
      initialMine={mine}
      projects={[{ id: PROJECT, name: "Shop" }]}
      initialError={null}
    />,
  );
}

describe("CommunityLibrary", () => {
  it("renders templates with author attribution, license, and usage counts", () => {
    renderLibrary();
    expect(screen.getByText("Checkout basics")).toBeInTheDocument();
    expect(screen.getByText(/by Ali QA/)).toBeInTheDocument();
    expect(screen.getAllByText("CC BY 4.0 (attribution)").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 views · 0 imports/)).toBeInTheDocument();
  });

  it("re-queries when the search text changes", async () => {
    renderLibrary();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "auth" } });
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(WS, expect.objectContaining({ search: "auth" })),
    );
  });

  it("previews cases and imports them as drafts into the chosen project", async () => {
    renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByText("Checkout with a valid card")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Import as drafts" }));
    await waitFor(() =>
      expect(importMock).toHaveBeenCalledWith(WS, PROJECT, TEMPLATE, {
        suiteName: "Checkout basics (imported)",
      }),
    );
    await waitFor(() => expect(screen.getByText(/Imported 1 cases as drafts/)).toBeInTheDocument());
  });

  it("offers reporting on other people's templates but not your own", async () => {
    renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByText(/Report this template/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    await waitFor(() => expect(reportMock).toHaveBeenCalledWith(WS, TEMPLATE, { reason: "spam" }));
  });

  it("shows your own templates with unpublish and delete", async () => {
    renderLibrary([MY_TEMPLATE]);
    expect(screen.getByText("Your published templates")).toBeInTheDocument();
    expect(screen.getByText("My auth suite")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    await waitFor(() => expect(unpublishMock).toHaveBeenCalledWith(WS, MINE));
  });
});
