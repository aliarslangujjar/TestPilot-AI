/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guards for the 2026-10-20 security-audit hardening
 * migration. These assert the enforcement-point fixes stay in the
 * migration file; the live check on a real database is the canary
 * query in the audit doc / completion report (the migration is
 * pattern-verified here like the rest of the post-2026-10-18 set).
 */

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020140000_security_hardening.sql"),
  "utf8",
);

const USAGE_FUNCTIONS = ["reserve_usage", "release_usage", "meter_usage", "set_storage_usage"];

const sql2 = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020150000_security_hardening_2.sql"),
  "utf8",
);

describe("security hardening migration 2 (Scope A addendum)", () => {
  it("removes member UPDATE on GitHub dispatches and memberships", () => {
    expect(sql2).toContain('drop policy "Members can update workflow dispatches"');
    expect(sql2).toContain("revoke update on public.github_workflow_dispatches from authenticated");
    expect(sql2).toContain(
      'drop policy "Admins can update memberships, but never demote the last owner"',
    );
    expect(sql2).toContain("revoke update on public.memberships from authenticated");
  });

  it("restricts browser-job inserts to fresh caller-authored queue rows", () => {
    expect(sql2).toContain("created_by = auth.uid()");
    expect(sql2).toContain("status = 'queued'");
    expect(sql2).toContain("result is null");
    expect(sql2).toContain("claimed_by is null");
  });

  it("forces workspaces.created_by from the caller JWT via trigger", () => {
    expect(sql2).toContain("new.created_by := auth.uid()");
    expect(sql2).toContain("trg_force_workspace_creator");
  });
});

describe("security hardening migration", () => {
  it("revokes the default PUBLIC execute on every usage RPC and keeps service_role", () => {
    for (const fn of USAGE_FUNCTIONS) {
      expect(sql).toMatch(
        new RegExp(
          `revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`),
      );
    }
  });

  it("makes revoked public reports immutable to members", () => {
    expect(sql).toContain("revoked_at is null");
    expect(sql).toContain('drop policy "Workspace members can update public reports"');
  });

  it("restricts member updates on public_reports to the revoked_at column only", () => {
    expect(sql).toContain("revoke update on public.public_reports from authenticated");
    expect(sql).toContain("grant update (revoked_at) on public.public_reports to authenticated");
  });
});
