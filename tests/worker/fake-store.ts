import type { JobRow, JobStore } from "@/workers/playwright/src/store";

/** In-memory JobStore for worker orchestration tests. */

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

export function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workspace_id: WS,
    project_id: PROJECT,
    idempotency_key: "test-key-12345678",
    plan: {
      version: "1",
      name: "Smoke",
      baseUrl: "https://app.example.com",
      allowedHosts: ["app.example.com"],
      steps: [{ action: "goto", url: "/" }],
    },
    status: "queued",
    attempts: 1,
    max_attempts: 2,
    cancel_requested: false,
    claimed_by: "worker-1",
    claimed_at: new Date().toISOString(),
    lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
    result: null,
    error: null,
    created_by: "user-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export interface FakeStore extends JobStore {
  jobs: Map<string, JobRow>;
  uploaded: Array<{ path: string; bytes: number }>;
  /** Hosts the fake resolver treats as existing. */
  workspaces: Set<string>;
  /** projectId -> workspaceId */
  projects: Map<string, string>;
  /** workspaceId -> member userIds */
  members: Map<string, Set<string>>;
  /** When true, claim() always loses the race (returns null). */
  claimAlwaysLoses: boolean;
}

export function makeFakeStore(seed: JobRow[] = []): FakeStore {
  const jobs = new Map(seed.map((j) => [j.id, { ...j }]));
  const store: FakeStore = {
    jobs,
    uploaded: [],
    workspaces: new Set([WS]),
    projects: new Map([[PROJECT, WS]]),
    members: new Map([[WS, new Set(["user-1"])]]),
    claimAlwaysLoses: false,

    async listQueued(limit) {
      return [...jobs.values()]
        .filter((j) => j.status === "queued")
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit)
        .map((j) => ({ ...j }));
    },
    async claim(id, workerId, leaseMs, attempts) {
      if (store.claimAlwaysLoses) return null;
      const job = jobs.get(id);
      if (!job || job.status !== "queued") return null; // lost the race
      const claimed: JobRow = {
        ...job,
        status: "running",
        attempts: attempts + 1,
        claimed_by: workerId,
        claimed_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
      };
      jobs.set(id, claimed);
      return { ...claimed };
    },
    async heartbeat(id, workerId, leaseMs) {
      const job = jobs.get(id);
      if (!job || job.claimed_by !== workerId || job.status !== "running") return false;
      job.lease_expires_at = new Date(Date.now() + leaseMs).toISOString();
      return true;
    },
    async update(id, patch) {
      const job = jobs.get(id);
      if (!job) throw new Error("job not found");
      jobs.set(id, { ...job, ...patch });
    },
    async getById(id) {
      const job = jobs.get(id);
      return job ? { ...job } : null;
    },
    async countRunningByWorkspace(workspaceId) {
      return [...jobs.values()].filter(
        (j) => j.workspace_id === workspaceId && j.status === "running",
      ).length;
    },
    async countRecentByWorkspace(workspaceId, sinceIso) {
      return [...jobs.values()].filter(
        (j) => j.workspace_id === workspaceId && j.created_at >= sinceIso,
      ).length;
    },
    async listStaleRunning(nowIso) {
      return [...jobs.values()]
        .filter(
          (j) =>
            j.status === "running" && j.lease_expires_at !== null && j.lease_expires_at < nowIso,
        )
        .map((j) => ({ ...j }));
    },
    async workspaceExists(workspaceId) {
      return store.workspaces.has(workspaceId);
    },
    async projectInWorkspace(projectId, workspaceId) {
      return store.projects.get(projectId) === workspaceId;
    },
    async isMember(workspaceId, userId) {
      return store.members.get(workspaceId)?.has(userId) ?? false;
    },
    async uploadArtifact(path, bytes) {
      store.uploaded.push({ path, bytes: bytes.length });
    },
  };
  return store;
}

export const TEST_WS = WS;
export const TEST_PROJECT = PROJECT;
