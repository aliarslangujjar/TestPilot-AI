/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARTIFACT_URL_TTL_SECONDS } from "@/lib/run-details/constants";
import { getArtifactSignedUrl, pruneBrowserArtifacts } from "@/lib/run-details/artifacts";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4333-8444-444444444444";
const JOB = "55555555-5555-4555-8555-555555555555";
const PATH_OWN = `${WS}/${JOB}/step-1.png`;
const PATH_OTHER_WS = `${WS2}/${JOB}/step-1.png`;

const {
  requireWorkspaceClientMock,
  createAdminClientMock,
  createSignedUrlMock,
  listMock,
  removeMock,
} = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
  listMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClientMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** run_results membership mock; `linked` controls the artifact reference check. */
function dbMock({ linked }: { linked: boolean }) {
  function chain(table: string) {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.in = vi.fn(() => q);
    q.limit = vi.fn(() => q);
    q.contains = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.maybeSingle = vi.fn(() => q);
    q.then = (resolve: (value: unknown) => void) => {
      if (table === "run_results") {
        resolve({ data: linked ? [{ id: "r1" }] : [], error: null });
      } else if (table === "test_runs") {
        resolve({ data: { id: RUN }, error: null });
      } else resolve({ data: null, error: null });
    };
    return q;
  }
  return { from: vi.fn((t: string) => chain(t)) };
}

function setup({
  linked = true,
  signedError = false,
}: { linked?: boolean; signedError?: boolean } = {}) {
  requireWorkspaceClientMock.mockResolvedValue({ supabase: dbMock({ linked }) });
  createSignedUrlMock.mockResolvedValue(
    signedError
      ? { data: null, error: new Error("Object not found") }
      : { data: { signedUrl: "https://example.supabase.co/signed/xyz?token=abc" }, error: null },
  );
  createAdminClientMock.mockReturnValue({
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: createSignedUrlMock,
        list: listMock,
        remove: removeMock,
      })),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  removeMock.mockResolvedValue({ error: null });
});

describe("getArtifactSignedUrl", () => {
  it("mints a short-lived (≤5 min) URL for an authorized, referenced artifact", async () => {
    setup();
    const res = await getArtifactSignedUrl(WS, PROJECT, RUN, PATH_OWN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.url).toContain("/signed/");
    const ttl = createSignedUrlMock.mock.calls[0]?.[1] as number;
    expect(ttl).toBe(ARTIFACT_URL_TTL_SECONDS);
    expect(ttl).toBeLessThanOrEqual(300);
    expect(res.data.expiresIn).toBe(ttl);
  });

  it("rejects artifacts from another workspace (path prefix)", async () => {
    setup();
    const res = await getArtifactSignedUrl(WS, PROJECT, RUN, PATH_OTHER_WS);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Artifact not found or expired.");
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace access even when the caller is a member elsewhere", async () => {
    // Caller is a member of WS2 asking through WS1's run: the reference check
    // (run_results linkage) fails because WS1 has no result for this path.
    setup({ linked: false });
    const res = await getArtifactSignedUrl(WS, PROJECT, RUN, PATH_OTHER_WS);
    expect(res.ok).toBe(false);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects in-workspace paths that no result references", async () => {
    setup({ linked: false });
    const res = await getArtifactSignedUrl(WS, PROJECT, RUN, PATH_OWN);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Artifact not found or expired.");
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects path traversal and malformed paths", async () => {
    setup();
    for (const bad of [
      `${WS}/../${WS2}/x.png`,
      `${WS}\\..\\x.png`,
      `//etc/passwd`,
      `${WS}/${JOB}`,
      "",
    ]) {
      const res = await getArtifactSignedUrl(WS, PROJECT, RUN, bad);
      expect(res.ok).toBe(false);
    }
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("reports missing/expired objects with a clean error, not a storage leak", async () => {
    setup({ signedError: true });
    const res = await getArtifactSignedUrl(WS, PROJECT, RUN, PATH_OWN);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Artifact not found or expired.");
  });

  it("denies non-members before touching storage", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await getArtifactSignedUrl(WS, PROJECT, RUN, PATH_OWN);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("You don't have access to this workspace.");
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe("pruneBrowserArtifacts", () => {
  const oldDate = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  const newDate = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

  function setupStorage() {
    requireWorkspaceClientMock.mockResolvedValue({ supabase: dbMock({ linked: true }) });
    listMock.mockImplementation((prefix: string) => {
      if (prefix === WS) {
        // One job folder (no id on folders) plus a stray file at the root.
        return Promise.resolve({
          data: [
            { id: null, name: JOB },
            { id: "f1", name: "stray.png", created_at: oldDate },
          ],
          error: null,
        });
      }
      return Promise.resolve({
        data: [
          { id: "a", name: "old.png", created_at: oldDate },
          { id: "b", name: "new.png", created_at: newDate },
          { id: "c", name: "unknown.png", created_at: null },
        ],
        error: null,
      });
    });
    createAdminClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: createSignedUrlMock,
          list: listMock,
          remove: removeMock,
        })),
      },
    });
  }

  it("deletes only files older than the retention window", async () => {
    setupStorage();
    const res = await pruneBrowserArtifacts(WS, 30);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.deleted).toBe(1);
    expect(res.data.scanned).toBe(3);
    expect(removeMock).toHaveBeenCalledOnce();
    const deleted = removeMock.mock.calls[0]?.[0] as string[];
    expect(deleted).toEqual([`${WS}/${JOB}/old.png`]);
    expect(deleted).not.toContain(`${WS}/${JOB}/new.png`);
    expect(deleted).not.toContain(`${WS}/${JOB}/unknown.png`);
  });

  it("refuses retention below the safety floor", async () => {
    setupStorage();
    const res = await pruneBrowserArtifacts(WS, 1);
    expect(res.ok).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await pruneBrowserArtifacts(WS, 30);
    expect(res.ok).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
