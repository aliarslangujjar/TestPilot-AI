-- 20261018140300_memberships.sql
--
-- Workspace memberships: who belongs to which workspace and with what role.
-- Roles: owner | admin | member.
--
-- Rules enforced here:
-- * Members can list the memberships of workspaces they belong to.
-- * Admins/owners can add, change, and remove memberships.
-- * A user may bootstrap themselves as owner of a workspace that has no
--   members yet (the workspace-creation flow).
-- * The last owner can neither be demoted nor removed.
--
-- Canary: select count(*) from information_schema.tables
--         where table_schema = 'public' and table_name = 'memberships';
--         -- expect 1

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index idx_memberships_workspace_id on public.memberships (workspace_id);
create index idx_memberships_user_id on public.memberships (user_id);

alter table public.memberships enable row level security;

create policy "Members can view memberships of their workspaces"
  on public.memberships for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Admins can add members; users can bootstrap ownership"
  on public.memberships for insert to authenticated
  with check (
    public.is_workspace_admin(workspace_id)
    or (
      user_id = auth.uid()
      and role = 'owner'
      and public.workspace_member_count(workspace_id) = 0
    )
  );

create policy "Admins can update memberships, but never demote the last owner"
  on public.memberships for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (
    public.is_workspace_admin(workspace_id)
    and (
      role = 'owner'
      or public.workspace_other_owner_count(workspace_id, memberships.id) >= 1
    )
  );

create policy "Admins can remove memberships, but never the last owner"
  on public.memberships for delete to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    and (
      role <> 'owner'
      or public.workspace_other_owner_count(workspace_id, memberships.id) >= 1
    )
  );

grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.memberships to service_role;
