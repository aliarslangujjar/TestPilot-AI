-- 20261018140400_projects.sql
--
-- Projects live inside exactly one workspace. Every operation requires
-- membership in that workspace, which is what prevents cross-workspace
-- access at the database layer.
--
-- Canary: select count(*) from information_schema.tables
--         where table_schema = 'public' and table_name = 'projects';
--         -- expect 1

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) >= 2),
  description text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create index idx_projects_workspace_id on public.projects (workspace_id);

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.handle_updated_at();

alter table public.projects enable row level security;

create policy "Workspace members can view projects"
  on public.projects for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create projects"
  on public.projects for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update projects"
  on public.projects for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete projects"
  on public.projects for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
