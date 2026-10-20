/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteGitHubIntegration,
  dispatchGitHubWorkflow,
  getGitHubIntegration,
  saveGitHubIntegration,
} from "@/lib/github/actions";
import { decryptSecret, encryptSecret } from "@/lib/github/crypto";
import { resetRateLimits } from "@/lib/public-reports/rate-limit";
import { WorkspaceAccessDeniedError } from "@/lib/supabase/workspace-auth";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const INTEGRATION = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const TOKEN = "github_pat_scoped_token_value";

const { requireWorkspaceClientMock, createAdminClientMock, fetchMock } = vi.hoisted(() => ({
  requireWorkspaceClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/workspace-authz", () => ({
  requireWorkspaceClient: (...args: unknown[]) => requireWorkspaceClientMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClientMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.stubGlobal("fetch", fetchMock);

interface RecordedOp {
  table: string;
  op: string;
  payload?: unknown;
  options?: unknown;
}

function chainMock(presets: Record<string, { data: unknown; error: unknown }>, ops: RecordedOp[]) {
  return function chain(table: string) {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = vi.fn(() => q);
    q.maybeSingle = vi.fn(() => q);
    q.single = vi.fn(() => q);
    q.insert = vi.fn((rows: unknown) => {
      ops.push({ table, op: "insert", payload: rows });
      return q;
    });
    q.update = vi.fn((patch: unknown) => {
      ops.push({ table, op: "update", payload: patch });
      return q;
    });
    q.delete = vi.fn(() => {
      ops.push({ table, op: "delete" });
      return q;
    });
    q.upsert = vi.fn((rows: unknown, options?: unknown) => {
      ops.push({ table, op: "upsert", payload: rows, options });
      return q;
    });
    q.then = (resolve: (value: unknown) => void) => {
      // For github_integrations, an insert/update in this db instance
      // resolves the row (single()); a plain select uses the preset.
      if (
        table === "github_integrations" &&
        ops.some((o) => o.table === table && (o.op === "insert" || o.op === "update"))
      ) {
        resolve({ data: INTEGRATION_ROW, error: null });
        return;
      }
      resolve(presets[table] ?? { data: null, error: null });
    };
    return q;
  };
}

const INTEGRATION_ROW = {
  id: INTEGRATION,
  project_id: PROJECT,
  repo_owner: "acme",
  repo_name: "shop",
  workflow_file: "qa.yml",
  default_ref: "main",
  enabled: true,
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-20T00:00:00.000Z",
};

const DISPATCH_ROW = {
  id: "55555555-5555-4555-8555-555555555555",
  status: "queued",
  conclusion: null,
  github_run_id: null,
  github_run_url: null,
  ref: "main",
  error: null,
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-20T00:00:00.000Z",
};

function setup(options: { existing?: boolean; dispatchStatus?: number } = {}) {
  const memberOps: RecordedOp[] = [];
  const adminOps: RecordedOp[] = [];
  const memberPresets: Record<string, { data: unknown; error: unknown }> = {
    projects: { data: { id: PROJECT }, error: null },
    github_integrations: {
      data: options.existing ? INTEGRATION_ROW : null,
      error: null,
    },
    github_workflow_dispatches: { data: DISPATCH_ROW, error: null },
  };
  // Insert path resolves the integration row too (single()).
  const member = { from: vi.fn(chainMock(memberPresets, memberOps)) };
  const adminPresets: Record<string, { data: unknown; error: unknown }> = {
    github_integration_secrets: {
      data: options.existing
        ? {
            token_encrypted: encryptSecret(TOKEN),
            webhook_secret_encrypted: encryptSecret("whsec_existing"),
          }
        : null,
      error: null,
    },
  };
  const admin = { from: vi.fn(chainMock(adminPresets, adminOps)) };

  requireWorkspaceClientMock.mockResolvedValue({ supabase: member, userId: USER });
  createAdminClientMock.mockReturnValue(admin);

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/repos/acme/shop") && (!init?.method || init.method === "GET")) {
      return jsonResponse(200, { full_name: "acme/shop" });
    }
    if (url.includes("/actions/workflows/qa.yml") && !url.includes("dispatches")) {
      return jsonResponse(200, { name: "QA", state: "active" });
    }
    if (url.includes("/dispatches")) {
      const status = options.dispatchStatus ?? 204;
      return {
        ok: status < 300,
        status,
        headers: new Headers(status === 403 ? { "x-ratelimit-remaining": "0" } : {}),
        json: async () => (status === 204 ? {} : { message: "Forbidden" }),
      };
    }
    return jsonResponse(404, { message: "Not Found" });
  });

  return { memberOps, adminOps };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

const SAVE_INPUT = {
  repoOwner: "acme",
  repoName: "shop",
  workflowFile: "qa.yml",
  defaultRef: "main",
  token: TOKEN,
};

describe("saveGitHubIntegration", () => {
  it("verifies the mapping, stores the token encrypted, and shows the webhook secret once", async () => {
    const { memberOps, adminOps } = setup();
    const res = await saveGitHubIntegration(WS, PROJECT, SAVE_INPUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.webhookSecret).toBeTruthy();
    expect(res.data.integration.repoOwner).toBe("acme");

    const upsert = adminOps.find((o) => o.table === "github_integration_secrets");
    const payload = upsert?.payload as {
      token_encrypted: string;
      webhook_secret_encrypted: string;
    };
    expect(payload.token_encrypted).not.toContain(TOKEN);
    expect(decryptSecret(payload.token_encrypted)).toBe(TOKEN);
    expect(decryptSecret(payload.webhook_secret_encrypted)).toBe(res.data.webhookSecret);
    expect(memberOps.some((o) => o.table === "github_integrations" && o.op === "insert")).toBe(
      true,
    );

    // The API shape never carries secret material.
    expect(JSON.stringify(res.data.integration)).not.toContain(TOKEN);
  });

  it("rejects a token that cannot access the repository (unauthorized repository)", async () => {
    const { memberOps } = setup();
    fetchMock.mockImplementation(async () => jsonResponse(404, { message: "Not Found" }));
    const res = await saveGitHubIntegration(WS, PROJECT, SAVE_INPUT);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/cannot access acme\/shop/);
    expect(memberOps.filter((o) => o.table === "github_integrations")).toHaveLength(0);
  });

  it("rejects a missing workflow file", async () => {
    setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/repos/acme/shop")) return jsonResponse(200, { full_name: "acme/shop" });
      return jsonResponse(404, { message: "Not Found" });
    });
    const res = await saveGitHubIntegration(WS, PROJECT, SAVE_INPUT);
    expect(res.ok === false && res.error).toMatch(/Workflow qa\.yml was not found/);
  });

  it("requires a token on first connect", async () => {
    setup();
    const noToken = {
      repoOwner: SAVE_INPUT.repoOwner,
      repoName: SAVE_INPUT.repoName,
      workflowFile: SAVE_INPUT.workflowFile,
      defaultRef: SAVE_INPUT.defaultRef,
    };
    const res = await saveGitHubIntegration(WS, PROJECT, noToken);
    expect(res.ok === false && res.error).toMatch(/token is required/);
  });

  it("keeps the stored token on mapping edits and returns no webhook secret", async () => {
    const { adminOps } = setup({ existing: true });
    const noToken = {
      repoOwner: SAVE_INPUT.repoOwner,
      repoName: SAVE_INPUT.repoName,
      workflowFile: SAVE_INPUT.workflowFile,
      defaultRef: SAVE_INPUT.defaultRef,
    };
    const res = await saveGitHubIntegration(WS, PROJECT, { ...noToken, workflowFile: "qa.yml" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.webhookSecret).toBeNull();
    // Stored token was used for verification and NOT overwritten.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
    expect(adminOps.filter((o) => o.table === "github_integration_secrets")).toHaveLength(0);
  });

  it("denies non-members", async () => {
    requireWorkspaceClientMock.mockRejectedValue(
      new WorkspaceAccessDeniedError(WS, "no-membership"),
    );
    const res = await saveGitHubIntegration(WS, PROJECT, SAVE_INPUT);
    expect(res.ok === false && res.error).toBe("You don't have access to this workspace.");
  });
});

describe("dispatchGitHubWorkflow", () => {
  it("records the dispatch and calls the GitHub dispatch endpoint", async () => {
    const { memberOps } = setup({ existing: true });
    const res = await dispatchGitHubWorkflow(WS, PROJECT, { inputs: { suite: "smoke" } });
    expect(res.ok).toBe(true);
    const insert = memberOps.find((o) => o.table === "github_workflow_dispatches");
    expect((insert?.payload as { status: string }).status).toBe("queued");
    const dispatchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/dispatches")) as [
      string,
      RequestInit,
    ];
    expect(dispatchCall).toBeTruthy();
    expect(JSON.parse(dispatchCall[1].body as string)).toEqual({
      ref: "main",
      inputs: { suite: "smoke" },
    });
  });

  it("marks the record dispatch_failed when GitHub rejects (rate limited)", async () => {
    const { memberOps } = setup({ existing: true, dispatchStatus: 403 });
    const res = await dispatchGitHubWorkflow(WS, PROJECT, {});
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/rate limit/);
    const update = memberOps.find(
      (o) => o.table === "github_workflow_dispatches" && o.op === "update",
    );
    expect((update?.payload as { status: string }).status).toBe("dispatch_failed");
  });

  it("enforces the per-workspace dispatch rate limit", async () => {
    setup({ existing: true });
    for (let i = 0; i < 20; i++) {
      const res = await dispatchGitHubWorkflow(WS, PROJECT, {});
      expect(res.ok).toBe(true);
    }
    const blocked = await dispatchGitHubWorkflow(WS, PROJECT, {});
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.error).toMatch(/rate limit reached/);
  });

  it("refuses to dispatch when the integration is disabled", async () => {
    const disabled = { ...INTEGRATION_ROW, enabled: false };
    const ops: RecordedOp[] = [];
    const chain = chainMock(
      {
        github_integrations: { data: disabled, error: null },
        github_workflow_dispatches: { data: DISPATCH_ROW, error: null },
      },
      ops,
    );
    requireWorkspaceClientMock.mockResolvedValue({
      supabase: { from: vi.fn(chain) },
      userId: USER,
    });
    createAdminClientMock.mockReturnValue({
      from: vi.fn(
        chainMock(
          {
            github_integration_secrets: {
              data: {
                token_encrypted: encryptSecret(TOKEN),
                webhook_secret_encrypted: encryptSecret("whsec"),
              },
              error: null,
            },
          },
          [],
        ),
      ),
    });
    const result = await dispatchGitHubWorkflow(WS, PROJECT, {});
    expect(result.ok === false && result.error).toBe("This GitHub integration is disabled.");
    expect(ops.filter((o) => o.op === "insert")).toHaveLength(0);
  });

  it("validates dispatch inputs (bounded plain strings only)", async () => {
    setup({ existing: true });
    const tooMany = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]));
    const res = await dispatchGitHubWorkflow(WS, PROJECT, { inputs: tooMany });
    expect(res.ok).toBe(false);
    const badKey = await dispatchGitHubWorkflow(WS, PROJECT, { inputs: { "bad key!": "v" } });
    expect(badKey.ok).toBe(false);
  });
});

describe("getGitHubIntegration / deleteGitHubIntegration", () => {
  it("reports hasToken without exposing any secret", async () => {
    setup({ existing: true });
    const res = await getGitHubIntegration(WS, PROJECT);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    expect(res.data.hasToken).toBe(true);
    expect(JSON.stringify(res.data)).not.toContain(TOKEN);
    expect(JSON.stringify(res.data)).not.toContain("whsec");
  });

  it("deletes the integration (secrets cascade)", async () => {
    const { memberOps } = setup({ existing: true });
    const res = await deleteGitHubIntegration(WS, PROJECT);
    expect(res.ok).toBe(true);
    expect(memberOps.some((o) => o.table === "github_integrations" && o.op === "delete")).toBe(
      true,
    );
  });
});
