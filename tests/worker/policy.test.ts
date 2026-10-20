/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { authorizeJob, checkRunLimits } from "@/workers/playwright/src/policy";

import { makeFakeStore, makeJob, TEST_PROJECT, TEST_WS } from "./fake-store";

describe("authorizeJob (worker-side, defense in depth)", () => {
  it("authorizes a well-formed job", async () => {
    const store = makeFakeStore();
    expect(await authorizeJob(store, makeJob())).toEqual({ ok: true });
  });

  it("rejects a job whose workspace no longer exists", async () => {
    const store = makeFakeStore();
    store.workspaces.clear();
    const decision = await authorizeJob(store, makeJob());
    expect(decision.ok).toBe(false);
  });

  it("rejects a job whose project left the workspace", async () => {
    const store = makeFakeStore();
    store.projects.set(TEST_PROJECT, "other-workspace");
    const decision = await authorizeJob(store, makeJob());
    expect(decision.ok).toBe(false);
  });

  it("rejects a job whose creator lost membership", async () => {
    const store = makeFakeStore();
    store.members.get(TEST_WS)?.delete("user-1");
    const decision = await authorizeJob(store, makeJob());
    expect(decision.ok).toBe(false);
  });

  it("rejects jobs with no recorded creator (fail closed — audit addendum)", async () => {
    const store = makeFakeStore();
    const decision = await authorizeJob(store, makeJob({ created_by: null }));
    expect(decision.ok).toBe(false);
  });
});

describe("checkRunLimits", () => {
  const limits = { maxConcurrentPerWorkspace: 2, dailyJobLimitPerWorkspace: 50 };

  it("defers when the workspace concurrency cap is reached", async () => {
    const store = makeFakeStore([
      makeJob({ id: "r1", status: "running" }),
      makeJob({ id: "r2", status: "running", idempotency_key: "k2" }),
    ]);
    const decision = await checkRunLimits(store, makeJob({ status: "queued" }), limits);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("concurrency cap");
  });

  it("defers when the daily quota is reached", async () => {
    const jobs = Array.from({ length: 50 }, (_, i) =>
      makeJob({ id: `j${i}`, idempotency_key: `key-${i}`, status: "queued" }),
    );
    const store = makeFakeStore(jobs);
    const decision = await checkRunLimits(
      store,
      makeJob({ id: "new", idempotency_key: "key-new", status: "queued" }),
      limits,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("daily job quota");
  });

  it("allows jobs under the limits", async () => {
    const store = makeFakeStore();
    expect(await checkRunLimits(store, makeJob({ status: "queued" }), limits)).toEqual({
      ok: true,
    });
  });
});
