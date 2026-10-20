import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { WorkerConfig } from "./config.js";

/**
 * Queue storage contract. The runner depends only on this interface, so
 * orchestration (claim/cancel/retry/reap) is unit-testable without a
 * database. The Supabase implementation below uses the service-role key
 * (Node side only — never handed to a browser) and re-validates
 * authorization explicitly, since service role bypasses RLS.
 */

export interface JobRow {
  id: string;
  workspace_id: string;
  project_id: string;
  run_id: string | null;
  test_case_id: string | null;
  idempotency_key: string;
  plan: unknown;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  failure_kind: "assertion" | "infra" | "timeout" | null;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  result: unknown;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobStore {
  listQueued(limit: number): Promise<JobRow[]>;
  /**
   * Atomically claim a job: the UPDATE only applies when the row is still
   * `queued`, so two workers racing for the same job cannot double-claim.
   * Returns the claimed row, or null when someone else won the race.
   */
  claim(id: string, workerId: string, leaseMs: number, attempts: number): Promise<JobRow | null>;
  heartbeat(id: string, workerId: string, leaseMs: number): Promise<boolean>;
  update(id: string, patch: Partial<JobRow>): Promise<void>;
  getById(id: string): Promise<JobRow | null>;
  countRunningByWorkspace(workspaceId: string): Promise<number>;
  countRecentByWorkspace(workspaceId: string, sinceIso: string): Promise<number>;
  listStaleRunning(nowIso: string): Promise<JobRow[]>;
  workspaceExists(workspaceId: string): Promise<boolean>;
  projectInWorkspace(projectId: string, workspaceId: string): Promise<boolean>;
  isMember(workspaceId: string, userId: string): Promise<boolean>;
  uploadArtifact(path: string, bytes: Uint8Array): Promise<void>;
}

const TABLE = "browser_jobs";

function leaseExpiry(leaseMs: number): string {
  return new Date(Date.now() + leaseMs).toISOString();
}

export function createSupabaseJobStore(config: WorkerConfig): JobStore {
  const client: SupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async listQueued(limit: number): Promise<JobRow[]> {
      const { data, error } = await client
        .from(TABLE)
        .select("*")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`listQueued failed: ${error.message}`);
      return (data ?? []) as JobRow[];
    },

    async claim(id, workerId, leaseMs, attempts): Promise<JobRow | null> {
      const now = new Date().toISOString();
      const { data, error } = await client
        .from(TABLE)
        .update({
          status: "running",
          attempts: attempts + 1,
          claimed_by: workerId,
          claimed_at: now,
          lease_expires_at: leaseExpiry(leaseMs),
        })
        .eq("id", id)
        .eq("status", "queued")
        .select()
        .maybeSingle();
      if (error) throw new Error(`claim failed: ${error.message}`);
      return (data ?? null) as JobRow | null;
    },

    async heartbeat(id, workerId, leaseMs): Promise<boolean> {
      const { data, error } = await client
        .from(TABLE)
        .update({ lease_expires_at: leaseExpiry(leaseMs) })
        .eq("id", id)
        .eq("claimed_by", workerId)
        .eq("status", "running")
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`heartbeat failed: ${error.message}`);
      return data !== null;
    },

    async update(id, patch): Promise<void> {
      // Terminal-state fence: a worker that lost its lease (host stall,
      // reaped, another worker completed the job) must not overwrite
      // the winner's terminal state or result with its own late write.
      const { error } = await client
        .from(TABLE)
        .update(patch)
        .eq("id", id)
        .not("status", "in", '("succeeded","failed","cancelled")');
      if (error) throw new Error(`update failed: ${error.message}`);
    },

    async getById(id): Promise<JobRow | null> {
      const { data, error } = await client.from(TABLE).select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`getById failed: ${error.message}`);
      return (data ?? null) as JobRow | null;
    },

    async countRunningByWorkspace(workspaceId): Promise<number> {
      const { count, error } = await client
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "running");
      if (error) throw new Error(`countRunning failed: ${error.message}`);
      return count ?? 0;
    },

    async countRecentByWorkspace(workspaceId, sinceIso): Promise<number> {
      const { count, error } = await client
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", sinceIso);
      if (error) throw new Error(`countRecent failed: ${error.message}`);
      return count ?? 0;
    },

    async listStaleRunning(nowIso): Promise<JobRow[]> {
      const { data, error } = await client
        .from(TABLE)
        .select("*")
        .eq("status", "running")
        .lt("lease_expires_at", nowIso);
      if (error) throw new Error(`listStaleRunning failed: ${error.message}`);
      return (data ?? []) as JobRow[];
    },

    async workspaceExists(workspaceId): Promise<boolean> {
      const { data, error } = await client
        .from("workspaces")
        .select("id")
        .eq("id", workspaceId)
        .maybeSingle();
      if (error) throw new Error(`workspaceExists failed: ${error.message}`);
      return data !== null;
    },

    async projectInWorkspace(projectId, workspaceId): Promise<boolean> {
      const { data, error } = await client
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw new Error(`projectInWorkspace failed: ${error.message}`);
      return data !== null;
    },

    async isMember(workspaceId, userId): Promise<boolean> {
      const { data, error } = await client
        .from("memberships")
        .select("workspace_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`isMember failed: ${error.message}`);
      return data !== null;
    },

    async uploadArtifact(path, bytes): Promise<void> {
      const { error } = await client.storage
        .from("browser-artifacts")
        .upload(path, bytes, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`uploadArtifact failed: ${error.message}`);
    },
  };
}
