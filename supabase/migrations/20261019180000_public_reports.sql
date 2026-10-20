-- 20261019180000_public_reports.sql
--
-- Opt-in, read-only public QA reports. A report snapshots a run's public-safe
-- summary at creation time; the public reads ONLY the snapshot, resolved via
-- a SHA-256 hash of an unguessable token (the raw token is never stored).
-- Revocation (revoked_at) and expiry (expires_at) are checked on every read.
-- Raw artifacts are never part of a report.
--
-- Canary: select count(*) from pg_tables
--          where schemaname = 'public' and tablename = 'public_reports';
--          -- expect 1

create table public.public_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  run_id uuid not null references public.test_runs (id) on delete cascade,
  run_name text not null check (char_length(run_name) <= 200),
  -- SHA-256 hex of the share token. The raw token exists only in the link
  -- the owner copies at creation time.
  token_hash text not null unique check (char_length(token_hash) = 64),
  -- Public-safe snapshot (publicReportSnapshotSchema). No ids, no logs,
  -- no artifact paths, no notes — enforced by the snapshot builder.
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  include_failure_details boolean not null default false,
  no_index boolean not null default true,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_public_reports_workspace_id on public.public_reports (workspace_id);
create index idx_public_reports_run_id on public.public_reports (run_id);
create index idx_public_reports_token_hash on public.public_reports (token_hash);

create trigger trg_public_reports_updated_at
  before update on public.public_reports
  for each row execute function public.handle_updated_at();

alter table public.public_reports enable row level security;

-- Owners (workspace members) manage their reports. There is deliberately
-- NO policy for anon/public roles: public reads go through the service
-- role in a server route that returns only the stored snapshot.
create policy "Workspace members can view public reports"
  on public.public_reports for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create public reports"
  on public.public_reports for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update public reports"
  on public.public_reports for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete public reports"
  on public.public_reports for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.public_reports to authenticated;
grant all on public.public_reports to service_role;

comment on table public.public_reports is
  'Opt-in public run reports. Public reads resolve token_hash via service role and return only the snapshot.';
comment on column public.public_reports.token_hash is
  'SHA-256 of the share token; the raw token is never stored.';
