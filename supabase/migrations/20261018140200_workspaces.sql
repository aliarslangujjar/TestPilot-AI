-- 20261018140200_workspaces.sql
--
-- Workspaces are the tenancy boundary. A workspace is visible only to its
-- members; only owners may delete one.
--
-- Canary: select count(*) from information_schema.tables
--         where table_schema = 'public' and table_name = 'workspaces';
--         -- expect 1

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) >= 2),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workspaces_created_by on public.workspaces (created_by);

create trigger trg_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.handle_updated_at();

alter table public.workspaces enable row level security;

create policy "Members can view their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

create policy "Authenticated users can create workspaces"
  on public.workspaces for insert to authenticated
  with check (true);

create policy "Workspace admins can update their workspaces"
  on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

create policy "Workspace owners can delete their workspaces"
  on public.workspaces for delete to authenticated
  using (public.workspace_user_role(id) = 'owner');

grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
