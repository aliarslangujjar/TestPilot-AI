/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ShareReportPanel } from "@/components/public-reports/share-report-panel";

const { createMock, listMock, revokeMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock("@/lib/public-reports/actions", () => ({
  createPublicReport: (...args: unknown[]) => createMock(...args),
  listPublicReports: (...args: unknown[]) => listMock(...args),
  revokePublicReport: (...args: unknown[]) => revokeMock(...args),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const RUN = "55555555-5555-4555-8555-555555555555";

const ACTIVE_REPORT = {
  id: "66666666-6666-4666-8666-666666666666",
  projectId: PROJECT,
  runId: RUN,
  runName: "Nightly run",
  includeFailureDetails: false,
  noIndex: true,
  expiresAt: null,
  revokedAt: null,
  viewCount: 3,
  lastViewedAt: null,
  createdAt: "2026-10-20T01:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => cleanup());

describe("ShareReportPanel", () => {
  it("creates a report and shows the one-time link with the hash warning", async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: { id: ACTIVE_REPORT.id, token: "tok123", path: "/r/tok123" },
    });
    render(<ShareReportPanel workspaceId={WS} projectId={PROJECT} runId={RUN} />);
    fireEvent.click(screen.getByRole("button", { name: "Create public link" }));
    await waitFor(() => expect(screen.getByLabelText("Public report link")).toBeInTheDocument());
    const input = screen.getByLabelText("Public report link") as HTMLInputElement;
    expect(input.value).toContain("/r/tok123");
    expect(screen.getByText(/only a hash of this link is stored/)).toBeInTheDocument();
    // Defaults: failure details off, noindex on.
    const args = createMock.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(args.includeFailureDetails).toBe(false);
    expect(args.noIndex).toBe(true);
  });

  it("lists existing reports with status and a revoke button", async () => {
    listMock.mockResolvedValue({ ok: true, data: [ACTIVE_REPORT] });
    revokeMock.mockResolvedValue({ ok: true, data: { revoked: true } });
    render(<ShareReportPanel workspaceId={WS} projectId={PROJECT} runId={RUN} />);
    await waitFor(() => expect(screen.getByText("active")).toBeInTheDocument());
    expect(screen.getByText(/3 views/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith(WS, PROJECT, ACTIVE_REPORT.id));
  });

  it("marks revoked reports and hides their revoke button", async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [{ ...ACTIVE_REPORT, revokedAt: "2026-10-20T02:00:00.000Z" }],
    });
    render(<ShareReportPanel workspaceId={WS} projectId={PROJECT} runId={RUN} />);
    await waitFor(() => expect(screen.getByText("revoked")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });
});
