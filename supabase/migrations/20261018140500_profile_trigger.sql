-- 20261018140500_profile_trigger.sql
--
-- Auto-create a profiles row whenever a new auth user appears, so app code
-- never has to remember it (and the owner-only RLS on profiles is enough).
--
-- Canary: select count(*) from pg_trigger where tgname = 'trg_auth_users_new_user';
--         -- expect 1

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_users_new_user on auth.users;

create trigger trg_auth_users_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();
