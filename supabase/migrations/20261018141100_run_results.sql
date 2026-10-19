-- 20261018141100_run_results.sql
--
-- Per-case results within a test run. Each result carries a snapshot of the
-- test case (title, steps, etc.) frozen at run creation, so later edits to
-- the test case never rewrite execution history. The test_case_id FK is
-- informational; the snapshot is the source of truth for the run.
--
-- Canary: select count(*) from pg_tables
--         where schemaname = 'public' and tablename = 'run_results';
--         -- expect 1

create table public.run_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.test_runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  test_case_id uuid references public.test_cases (id) on delete set null,
  snapshot jsonb not null,
  outcome text not null default 'unexecuted'
    check (outcome in ('unexecuted', 'pass', 'fail', 'blocked', 'skipped')),
  notes text,
  executed_by uuid references auth.users (id) on delete set null,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, test_case_id)
);

create index idx_run_results_run_id on public.run_results (run_id);
create index idx_run_results_workspace_id on public.run_results (workspace_id);
create index idx_run_results_outcome on public.run_results (outcome);

create trigger trg_run_results_updated_at
  before update on public.run_results
  for each row execute function public.handle_updated_at();

alter table public.run_results enable row level security;

create policy "Workspace members can view run results"
  on public.run_results for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create run results"
  on public.run_results for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update run results"
  on public.run_results for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete run results"
  on public.run_results for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.run_results to authenticated;
grant all on public.run_results to service_role;
