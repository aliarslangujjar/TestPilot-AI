-- 20261018140000_core_helpers.sql
--
-- Shared helpers for the core schema. SECURITY DEFINER functions are the
-- ONLY way policies may inspect other RLS-protected tables: a subquery on
-- the same table inside its own policy causes infinite recursion, while a
-- security-definer function bypasses RLS by design.
--
-- Canary: select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname in
--         ('handle_updated_at','is_workspace_member','workspace_user_role',
--          'is_workspace_admin','workspace_owner_count','workspace_member_count');
--         -- expect 6

create extension if not exists "pgcrypto";

-- Generic updated_at maintainer used by every table with an updated_at column.
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- NOTE: helpers are plpgsql (not sql) so they can be created before the
-- tables they reference exist; plpgsql bodies are validated at first
-- execution, while sql bodies are validated at CREATE FUNCTION time.

-- True when the calling user holds any membership in the workspace.
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
  );
end;
$$;

-- The calling user's role in the workspace, or null when not a member.
create or replace function public.workspace_user_role(p_workspace_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select m.role into v_role
  from public.memberships m
  where m.workspace_id = p_workspace_id
    and m.user_id = auth.uid()
  limit 1;
  return v_role;
end;
$$;

-- True when the calling user is an owner or admin of the workspace.
create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(public.workspace_user_role(p_workspace_id) in ('owner', 'admin'), false);
end;
$$;

-- Number of owners in the workspace (used for last-owner protection).
create or replace function public.workspace_owner_count(p_workspace_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.memberships m
  where m.workspace_id = p_workspace_id
    and m.role = 'owner';
  return v_count;
end;
$$;

-- Number of owners in the workspace excluding one membership row
-- (used to protect the last owner on demote/remove).
create or replace function public.workspace_other_owner_count(p_workspace_id uuid, p_exclude_membership_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.memberships m
  where m.workspace_id = p_workspace_id
    and m.role = 'owner'
    and m.id <> p_exclude_membership_id;
  return v_count;
end;
$$;

-- Number of memberships in the workspace (used for ownership bootstrap).
create or replace function public.workspace_member_count(p_workspace_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.memberships m
  where m.workspace_id = p_workspace_id;
  return v_count;
end;
$$;

grant execute on function public.handle_updated_at() to authenticated, service_role;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.workspace_user_role(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_admin(uuid) to authenticated, service_role;
grant execute on function public.workspace_owner_count(uuid) to authenticated, service_role;
grant execute on function public.workspace_other_owner_count(uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_member_count(uuid) to authenticated, service_role;
