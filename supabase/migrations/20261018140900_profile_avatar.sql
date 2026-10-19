-- 20261018140900_profile_avatar.sql
--
-- Adds an optional avatar URL to user profiles. Existing RLS policies
-- ("Users can view/update their own profile") already cover all columns,
-- so no policy changes are needed.
--
-- Canary: select count(*) from information_schema.columns
--         where table_schema = 'public' and table_name = 'profiles'
--         and column_name = 'avatar_url';
--         -- expect 1

alter table public.profiles
  add column avatar_url text;
