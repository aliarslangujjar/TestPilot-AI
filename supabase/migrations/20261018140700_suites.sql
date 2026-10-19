-- 20261018140700_suites.sql
--
-- Test suites group manual test cases inside a project. Archiving is soft
-- (is_archived); history is never deleted.
--
-- Canary: select count(*) from pg_tables
--          where schemaname = 'public' and tablename = 'suites';
--          -- expect 1

create table public.suites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) >= 2 and char_length(name) <= 100),
  description text,
  is_archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

create index idx_suites_workspace_id on public.suites (workspace_id);
create index idx_suites_project_id on public.suites (project_id);

create trigger trg_suites_updated_at
  before update on public.suites
  for each row execute function public.handle_updated_at();

alter table public.suites enable row level security;

create policy "Workspace members can view suites"
  on public.suites for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create suites"
  on public.suites for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update suites"
  on public.suites for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete suites"
  on public.suites for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.suites to authenticated;
grant all on public.suites to service_role;

comment on table public.suites is
  'Manual test suites inside a project. Archiving is soft; history is never deleted.';
