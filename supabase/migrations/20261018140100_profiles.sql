-- 20261018140100_profiles.sql
--
-- One profile row per auth user. A user may only ever see or touch
-- their own profile.
--
-- Canary: select count(*) from information_schema.tables
--         where table_schema = 'public' and table_name = 'profiles';
--         -- expect 1

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No delete policy: profiles are removed by the auth.users cascade only.

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
