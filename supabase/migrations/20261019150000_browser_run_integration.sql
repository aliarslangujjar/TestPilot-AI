-- 20261019150000_browser_run_integration.sql
--
-- Connects automated test runs to the browser-job queue and worker.
--
-- - browser_plans: one validated v1 plan per test case (the automatable
--   unit). A case without a plan cannot join an automated run.
-- - browser_jobs: run_id / test_case_id link a job to its run result;
--   failure_kind distinguishes assertion failures from infra failures
--   and timeouts (timeouts surface as run state `timed_out`).
-- - test_runs.execution_status: persisted automation lifecycle
--   (queued/running/passed/failed/cancelled/timed_out), separate from
--   the manual in_progress/completed lifecycle column.
-- - run_results: browser_job_id (unique where set — the idempotency
--   anchor for result sync), execution_status, and sanitized artifact
--   references copied from the worker's result.

-- 1. Per-case browser plans.
create table public.browser_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  test_case_id uuid not null references public.test_cases (id) on delete cascade,
  plan jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (test_case_id)
);

create index idx_browser_plans_case on public.browser_plans (test_case_id);
create index idx_browser_plans_workspace on public.browser_plans (workspace_id);

create trigger trg_browser_plans_updated_at
  before update on public.browser_plans
  for each row execute function public.handle_updated_at();

alter table public.browser_plans enable row level security;

create policy "Workspace members can view browser plans"
  on public.browser_plans for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create browser plans"
  on public.browser_plans for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update browser plans"
  on public.browser_plans for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete browser plans"
  on public.browser_plans for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.browser_plans to authenticated;
grant all on public.browser_plans to service_role;

-- 2. Job linkage + failure classification.
alter table public.browser_jobs
  add column run_id uuid references public.test_runs (id) on delete set null,
  add column test_case_id uuid references public.test_cases (id) on delete set null,
  add column failure_kind text check (failure_kind in ('assertion', 'infra', 'timeout'));

create index idx_browser_jobs_run on public.browser_jobs (run_id);
create index idx_browser_jobs_case on public.browser_jobs (test_case_id);

-- 3. Run-level automation lifecycle (manual status column untouched).
alter table public.test_runs
  add column execution_status text
    check (execution_status in ('queued', 'running', 'passed', 'failed', 'cancelled', 'timed_out'));

-- 4. Result-level automation state.
alter table public.run_results
  add column browser_job_id uuid references public.browser_jobs (id) on delete set null,
  add column execution_status text
    check (execution_status in ('queued', 'running', 'passed', 'failed', 'cancelled', 'timed_out')),
  add column artifacts text[] not null default '{}';

-- One job feeds at most one result: the idempotency anchor for sync.
create unique index uq_run_results_browser_job
  on public.run_results (browser_job_id)
  where browser_job_id is not null;
