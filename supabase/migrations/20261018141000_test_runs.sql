-- 20261018141000_test_runs.sql
--
-- Test runs: a manual (or, later, automated) execution pass over a set of
-- test cases. Summaries are always computed from run_results at read time —
-- no denormalized counters, so concurrent result updates cannot corrupt them.
--
-- Canary: select count(*) from pg_tables
--         where schemaname = 'public' and tablename = 'test_runs';
--         -- expect 1

create table public.test_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  suite_id uuid references public.suites (id) on delete set null,
  name text not null check (char_length(name) between 2 and 100),
  source text not null default 'manual' check (source in ('manual', 'automated')),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_test_runs_workspace_id on public.test_runs (workspace_id);
create index idx_test_runs_project_id on public.test_runs (project_id);
create index idx_test_runs_status on public.test_runs (status);

create trigger trg_test_runs_updated_at
  before update on public.test_runs
  for each row execute function public.handle_updated_at();

alter table public.test_runs enable row level security;

create policy "Workspace members can view test runs"
  on public.test_runs for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create test runs"
  on public.test_runs for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update test runs"
  on public.test_runs for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete test runs"
  on public.test_runs for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.test_runs to authenticated;
grant all on public.test_runs to service_role;
