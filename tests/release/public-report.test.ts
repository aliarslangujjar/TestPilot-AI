/** @vitest-environment node */
/**
 * Release-readiness scenario: public QA report sharing lifecycle —
 * create from a completed manual run → anonymous resolve serves the
 * sanitized snapshot → revoke → the same link is indistinguishable
 * from a link that never existed. Plus the negative space: malformed
 * tokens, expired reports, and cross-workspace revocation attempts.
 *
 * Same harness style as the journey test: real actions + real access
 * logic, fake data plane, no production data.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePublicReport } from "@/lib/public-reports/access";
import { createPublicReport, revokePublicReport } from "@/lib/public-reports/actions";
import { hashShareToken } from "@/lib/public-reports/token";

import { FakeAppDb, RELEASE_OTHER_USER, RELEASE_USER } from "./fake-app-db";

const W = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const CASE_A = "66666666-6666-4666-8666-666666666666";
const CASE_B = "77777777-7777-4777-8777-777777777777";

const db = new FakeAppDb();
const authState: { currentUser: { id: string; email: string } | null } = {
  currentUser: { id: RELEASE_USER, email: "qa@example.com" },
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...db.client(),
    auth: { getUser: async () => ({ data: { user: authState.currentUser } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => db.client(),
}));

function seedRun(): void {
  db.seed("memberships", [{ workspace_id: W, user_id: RELEASE_USER, role: "owner" }]);
  db.seed("projects", [{ id: P, workspace_id: W, name: "Demo Shop" }]);
  db.seed("test_runs", [
    {
      id: RUN,
      workspace_id: W,
      project_id: P,
      suite_id: null,
      name: "Release smoke run",
      source: "manual",
      status: "completed",
      execution_status: null,
      notes: null,
      created_by: RELEASE_USER,
      created_at: "2026-10-20T10:00:00.000Z",
      updated_at: "2026-10-20T10:05:00.000Z",
      completed_at: "2026-10-20T10:05:00.000Z",
    },
  ]);
  db.seed("run_results", [
    {
      id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      run_id: RUN,
      workspace_id: W,
      test_case_id: CASE_A,
      snapshot: { title: "Sign in with valid credentials" },
      outcome: "pass",
      browser_job_id: null,
      execution_status: null,
      artifacts: [],
      notes: null,
      executed_by: RELEASE_USER,
      executed_at: "2026-10-20T10:01:00.000Z",
    },
    {
      id: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      run_id: RUN,
      workspace_id: W,
      test_case_id: CASE_B,
      snapshot: { title: "Sign in with a wrong password" },
      outcome: "fail",
      browser_job_id: null,
      execution_status: null,
      artifacts: [],
      notes: null,
      executed_by: RELEASE_USER,
      executed_at: "2026-10-20T10:02:00.000Z",
    },
  ]);
}

beforeEach(() => {
  db.tables.clear();
  db.ops.length = 0;
  authState.currentUser = { id: RELEASE_USER, email: "qa@example.com" };
  seedRun();
});

describe("release scenario — public report sharing lifecycle", () => {
  it("creates, resolves, and revokes a public report", async () => {
    const created = await createPublicReport(W, P, RUN, {
      includeFailureDetails: true,
      expiresInDays: 7,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    expect(created.data.path).toBe(`/r/${created.data.token}`);

    // Only the hash is stored — the raw token never touches the table.
    const stored = db.rows("public_reports");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).toBe(hashShareToken(created.data.token));
    expect(JSON.stringify(stored[0])).not.toContain(created.data.token);

    // Anonymous resolve serves the snapshot with the run's real totals.
    const resolved = await resolvePublicReport(created.data.token, "203.0.113.10");
    expect(resolved.status).toBe("ok");
    if (resolved.status !== "ok") throw new Error("expected ok resolution");
    expect(resolved.snapshot.runName).toBe("Release smoke run");
    expect(resolved.snapshot.projectName).toBe("Demo Shop");
    expect(resolved.snapshot.summary.total).toBe(2);
    expect(resolved.snapshot.summary.passed).toBe(1);
    expect(resolved.snapshot.summary.failed).toBe(1);
    const titles = resolved.snapshot.cases.map((c) => c.title);
    expect(titles).toContain("Sign in with valid credentials");
    expect(titles).toContain("Sign in with a wrong password");

    // Revocation kills the link — indistinguishable from never existing.
    const revoked = await revokePublicReport(W, P, created.data.id);
    expect(revoked.ok).toBe(true);
    const after = await resolvePublicReport(created.data.token, "203.0.113.10");
    expect(after.status).toBe("not_found");
  });

  it("rejects malformed and unknown tokens identically, and expired reports", async () => {
    expect((await resolvePublicReport("not-a-token", "203.0.113.11")).status).toBe("not_found");
    expect((await resolvePublicReport("a".repeat(43), "203.0.113.11")).status).toBe("not_found");

    // A well-formed token whose report expired yesterday.
    const expiredToken = "b".repeat(43);
    const created = await createPublicReport(W, P, RUN, {});
    if (!created.ok) throw new Error("setup failed");
    db.seed("public_reports", [
      {
        id: "99999999-9999-4999-8999-999999999999",
        workspace_id: W,
        project_id: P,
        run_id: RUN,
        run_name: "Old run",
        token_hash: hashShareToken(expiredToken),
        snapshot: db.rows("public_reports")[0]?.snapshot,
        include_failure_details: false,
        no_index: true,
        expires_at: "2026-10-19T00:00:00.000Z",
        revoked_at: null,
        view_count: 0,
        created_by: RELEASE_USER,
      },
    ]);
    expect((await resolvePublicReport(expiredToken, "203.0.113.11")).status).toBe("not_found");
  });

  it("refuses report creation and revocation across workspaces", async () => {
    const created = await createPublicReport(W, P, RUN, {});
    if (!created.ok) throw new Error("setup failed");

    authState.currentUser = { id: RELEASE_OTHER_USER, email: "intruder@example.com" };
    const foreignCreate = await createPublicReport(W, P, RUN, {});
    expect(foreignCreate.ok).toBe(false);
    const foreignRevoke = await revokePublicReport(W, P, created.data.id);
    expect(foreignRevoke.ok).toBe(false);

    // The report is untouched and still resolvable by its holder.
    const resolved = await resolvePublicReport(created.data.token, "203.0.113.12");
    expect(resolved.status).toBe("ok");
    expect(db.rows("public_reports")).toHaveLength(1);
  });

  it("refuses to report on a run that does not exist", async () => {
    const missing = await createPublicReport(W, P, "88888888-8888-4888-8888-888888888888", {});
    expect(missing.ok).toBe(false);
    expect(db.rows("public_reports")).toHaveLength(0);
  });
});
