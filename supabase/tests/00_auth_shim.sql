-- supabase/tests/00_auth_shim.sql
--
-- Minimal stand-in for Supabase's auth layer, for LOCAL RLS testing only
-- (this VM has PostgreSQL 16 but no Docker, so `supabase start` is
-- unavailable). It mirrors the pieces our migrations depend on:
--
--   * roles: anon, authenticated, service_role (bypasses RLS, like Supabase)
--   * auth.users(id, email) with FK targets
--   * auth.uid() reading request.jwt.claims -> 'sub', exactly like Supabase
--
-- Idempotent: safe to re-run. Never applied to a real Supabase project
-- (which already provides all of this).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- Mirrors Supabase's auth.uid(): null when no (valid) JWT claim is set.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
