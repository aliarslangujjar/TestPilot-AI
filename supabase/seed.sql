-- supabase/seed.sql
--
-- Demo seed for local development. Applied by `supabase db reset`
-- (Supabase CLI) after migrations. Idempotent via ON CONFLICT.
--
-- Seeds workspaces and projects only. Memberships and profiles require
-- real auth users, so they are intentionally NOT seeded here — create test
-- users via the Supabase Studio Auth panel (or the Auth API), then add
-- memberships through the app. See supabase/tests/ for the RLS test setup,
-- which creates its own throwaway users.

insert into public.workspaces (id, name) values
  ('e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'Demo workspace')
on conflict (id) do nothing;

insert into public.projects (workspace_id, name, description) values
  ('e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'Demo storefront', 'Sample project for local UI development'),
  ('e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'Demo marketing site', 'Sample project for local UI development')
on conflict (workspace_id, name) do nothing;
