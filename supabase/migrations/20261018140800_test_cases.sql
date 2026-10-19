-- 20261018140800_test_cases.sql
--
-- Manual test cases inside a suite. Steps are a JSON array of
-- { "action": string, "expected": string | null }; the overall pass
-- criteria live in expected_results. workspace_id is denormalized so RLS
-- and app-level scoping never need a join. Archiving is soft; history is
-- never deleted.
--
-- Canary: select count(*) from pg_tables
--          where schemaname = 'public' and tablename = 'test_cases';
--          -- expect 1

create table public.test_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  suite_id uuid not null references public.suites (id) on delete cascade,
  title text not null check (char_length(title) >= 2 and char_length(title) <= 200),
  description text,
  preconditions text,
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  expected_results text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  tags text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'active')),
  is_archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_test_cases_workspace_id on public.test_cases (workspace_id);
create index idx_test_cases_suite_id on public.test_cases (suite_id);
create index idx_test_cases_status on public.test_cases (status);
create index idx_test_cases_priority on public.test_cases (priority);

create trigger trg_test_cases_updated_at
  before update on public.test_cases
  for each row execute function public.handle_updated_at();

alter table public.test_cases enable row level security;

create policy "Workspace members can view test cases"
  on public.test_cases for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create test cases"
  on public.test_cases for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update test cases"
  on public.test_cases for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete test cases"
  on public.test_cases for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.test_cases to authenticated;
grant all on public.test_cases to service_role;

comment on table public.test_cases is
  'Manual test cases inside a suite. Archiving is soft; history is never deleted.';
comment on column public.test_cases.steps is
  'JSON array of { "action": string, "expected": string | null } objects, in execution order.';
