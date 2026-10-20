/** @vitest-environment node */
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/lib/github/crypto";
import { handleGitHubWebhook } from "@/lib/github/webhook";

const { createAdminClientMock, fetchMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClientMock(...args),
}));

vi.stubGlobal("fetch", fetchMock);

const INTEGRATION = {
  id: "int-1",
  workspace_id: "ws-1",
  project_id: "proj-1",
  repo_owner: "acme",
  repo_name: "shop",
  workflow_file: "qa.yml",
  enabled: true,
};

const WEBHOOK_SECRET = "whsec_test_secret_value";
const TOKEN = "github_pat_test";

const state = {
  deliveries: new Set<string>(),
  dispatchUpdates: [] as Array<Record<string, unknown>>,
  queuedDispatch: null as Record<string, unknown> | null,
  byRunDispatch: null as Record<string, unknown> | null,
};

function adminMock() {
  function chain(table: string) {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "ilike", "is", "in", "order", "limit"]) {
      q[m] = vi.fn((...args: unknown[]) => {
        calls.push({ method: m, args });
        return q;
      });
    }
    q.maybeSingle = vi.fn(() => q);
    q.insert = vi.fn((row: { delivery_id: string }) => {
      if (table === "github_webhook_deliveries") {
        if (state.deliveries.has(row.delivery_id)) {
          return Promise.resolve({ data: null, error: { code: "23505" } });
        }
        state.deliveries.add(row.delivery_id);
        return Promise.resolve({ data: null, error: null });
      }
      return q;
    });
    q.update = vi.fn((patch: Record<string, unknown>) => {
      if (table === "github_workflow_dispatches") state.dispatchUpdates.push(patch);
      return q;
    });
    q.then = (resolve: (value: unknown) => void) => {
      if (table === "github_integrations") {
        resolve({ data: [INTEGRATION], error: null });
      } else if (table === "github_integration_secrets") {
        resolve({
          data: {
            token_encrypted: encryptSecret(TOKEN),
            webhook_secret_encrypted: encryptSecret(WEBHOOK_SECRET),
          },
          error: null,
        });
      } else if (table === "github_workflow_dispatches") {
        const byRun = calls.some(
          (c) => c.method === "eq" && (c.args as unknown[])[0] === "github_run_id",
        );
        resolve({
          data: byRun ? state.byRunDispatch : state.queuedDispatch ? [state.queuedDispatch] : [],
          error: null,
        });
      } else {
        resolve({ data: null, error: null });
      }
    };
    return q;
  }
  return { from: vi.fn((t: string) => chain(t)) };
}

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function workflowRunBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    repository: { full_name: "acme/shop" },
    workflow: { path: ".github/workflows/qa.yml" },
    workflow_run: {
      id: 4242,
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/acme/shop/actions/runs/4242",
      head_sha: "abc123sha",
      created_at: "2026-10-20T10:00:00Z",
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  state.deliveries = new Set();
  state.dispatchUpdates = [];
  state.queuedDispatch = {
    id: "disp-1",
    status: "queued",
    github_run_id: null,
    status_published: false,
  };
  state.byRunDispatch = null;
  createAdminClientMock.mockReturnValue(adminMock());
  fetchMock.mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => ({}),
  });
});

describe("handleGitHubWebhook", () => {
  it("processes a valid completed workflow_run and publishes a commit status", async () => {
    const body = workflowRunBody();
    const res = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body),
      deliveryId: "d-1",
      event: "workflow_run",
    });
    expect(res.status).toBe(200);
    const applied = state.dispatchUpdates.find((u) => u.status === "completed");
    expect(applied).toBeTruthy();
    expect(applied?.github_run_id).toBe(4242);
    expect(applied?.conclusion).toBe("success");

    // Commit status published to the run's SHA, target = authorized app page.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/repos/acme/shop/statuses/abc123sha");
    const sent = JSON.parse(init.body as string) as {
      state: string;
      target_url: string;
      context: string;
    };
    expect(sent.state).toBe("success");
    expect(sent.target_url).toBe("https://app.example.com/dashboard/projects/proj-1");
    expect(sent.context).toBe("testpilot/qa");
    expect(state.dispatchUpdates.some((u) => u.status_published === true)).toBe(true);
  });

  it("rejects an invalid signature and records nothing", async () => {
    const body = workflowRunBody();
    const res = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body, "wrong-secret"),
      deliveryId: "d-2",
      event: "workflow_run",
    });
    expect(res.status).toBe(401);
    expect(state.deliveries.size).toBe(0);
    expect(state.dispatchUpdates).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed signature", async () => {
    const body = workflowRunBody();
    for (const signature of [null, "sha1=abc", "sha256=zz"]) {
      const res = await handleGitHubWebhook({
        rawBody: body,
        signature,
        deliveryId: "d-3",
        event: "workflow_run",
      });
      expect(res.status).toBe(401);
    }
  });

  it("answers unknown repositories exactly like a bad signature (no enumeration oracle)", async () => {
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => {
        const q: Record<string, unknown> = {};
        for (const m of ["select", "ilike"]) q[m] = vi.fn(() => q);
        q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        return q;
      }),
    });
    const body = workflowRunBody();
    const res = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body),
      deliveryId: "d-4",
      event: "workflow_run",
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid signature." });
  });

  it("stores a non-https run URL as null (stored-XSS guard, audit addendum 3)", async () => {
    const body = workflowRunBody({
      workflow_run: {
        id: 4243,
        status: "completed",
        conclusion: "failure",
        html_url: "javascript:alert(1)",
        head_sha: "abc123sha",
        created_at: "2026-10-20T10:00:00Z",
      },
    });
    const res = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body),
      deliveryId: "d-js",
      event: "workflow_run",
    });
    expect(res.status).toBe(200);
    const applied = state.dispatchUpdates.find((u) => u.status === "completed");
    expect(applied?.github_run_url).toBeNull();
  });

  it("treats a duplicate delivery as a no-op (event applied once)", async () => {
    const body = workflowRunBody();
    const first = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body),
      deliveryId: "d-5",
      event: "workflow_run",
    });
    expect(first.status).toBe(200);
    const updatesAfterFirst = state.dispatchUpdates.length;

    const second = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body),
      deliveryId: "d-5",
      event: "workflow_run",
    });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(state.dispatchUpdates.length).toBe(updatesAfterFirst);
    expect(fetchMock).toHaveBeenCalledTimes(1); // status published once
  });

  it("ignores runs for other workflow files and runs we did not dispatch", async () => {
    const other = workflowRunBody({ workflow: { path: ".github/workflows/deploy.yml" } });
    const res1 = await handleGitHubWebhook({
      rawBody: other,
      signature: sign(other),
      deliveryId: "d-6",
      event: "workflow_run",
    });
    expect(res1.status).toBe(202);

    state.queuedDispatch = null;
    const body = workflowRunBody();
    const res2 = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body),
      deliveryId: "d-7",
      event: "workflow_run",
    });
    expect(res2.status).toBe(202);
    expect(state.dispatchUpdates).toHaveLength(0);
  });

  it("still returns 200 when commit-status publishing fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const body = workflowRunBody();
    const res = await handleGitHubWebhook({
      rawBody: body,
      signature: sign(body),
      deliveryId: "d-8",
      event: "workflow_run",
    });
    expect(res.status).toBe(200);
    expect(state.dispatchUpdates.some((u) => u.status === "completed")).toBe(true);
    expect(state.dispatchUpdates.some((u) => u.status_published === true)).toBe(false);
  });

  it("answers ping and ignores unrelated events", async () => {
    const ping = JSON.stringify({ repository: { full_name: "acme/shop" }, zen: "hi" });
    const res = await handleGitHubWebhook({
      rawBody: ping,
      signature: sign(ping),
      deliveryId: "d-9",
      event: "ping",
    });
    expect(res.status).toBe(200);

    const push = workflowRunBody();
    const res2 = await handleGitHubWebhook({
      rawBody: push,
      signature: sign(push),
      deliveryId: "d-10",
      event: "push",
    });
    expect(res2.status).toBe(202);
    expect(state.dispatchUpdates).toHaveLength(0);
  });
});
