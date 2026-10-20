-- 20261019200000_github_integrations.sql
--
-- Opt-in GitHub Actions integration (manual workflow dispatch first).
--
-- Design:
-- - github_integrations: the validated project <-> repository mapping.
--   Workspace-member RLS like the rest of the product.
-- - github_integration_secrets: the GitHub token and webhook secret,
--   AES-256-GCM encrypted (key in server env only). RLS is ENABLED with
--   NO policies: no authenticated client can read or write this table
--   at all. Only the service role (server-side, after a membership
--   check) touches it. Secrets are write-only from the user's side.
-- - github_workflow_dispatches: one row per manual dispatch, updated by
--   signed webhook events as the run progresses.
-- - github_webhook_deliveries: processed delivery ids (service-role
--   only) — the duplicate-event protection ledger.
--
-- Canary: select count(*) from pg_tables
--          where schemaname = 'public'
--            and tablename in ('github_integrations', 'github_integration_secrets',
--                              'github_workflow_dispatches', 'github_webhook_deliveries');
--          -- expect 4

create table public.github_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  repo_owner text not null check (char_length(repo_owner) between 1 and 39),
  repo_name text not null check (char_length(repo_name) between 1 and 100),
  workflow_file text not null check (workflow_file ~ '^[A-Za-z0-9._-]+\.ya?ml$'),
  default_ref text not null default 'main' check (char_length(default_ref) between 1 and 100),
  enabled boolean not null default true,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create index idx_github_integrations_workspace on public.github_integrations (workspace_id);
create index idx_github_integrations_repo on public.github_integrations (lower(repo_owner), lower(repo_name));

create trigger trg_github_integrations_updated_at
  before update on public.github_integrations
  for each row execute function public.handle_updated_at();

alter table public.github_integrations enable row level security;

create policy "Members can view GitHub integrations"
  on public.github_integrations for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can create GitHub integrations"
  on public.github_integrations for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());

create policy "Members can update GitHub integrations"
  on public.github_integrations for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Members can delete GitHub integrations"
  on public.github_integrations for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.github_integrations to authenticated;
grant all on public.github_integrations to service_role;

comment on table public.github_integrations is
  'Opt-in GitHub Actions mapping: one repository workflow per project. Tokens live in github_integration_secrets.';

create table public.github_integration_secrets (
  integration_id uuid primary key references public.github_integrations (id) on delete cascade,
  -- AES-256-GCM ciphertext (v1.<iv>.<tag>.<data>), key from server env.
  token_encrypted text not null,
  webhook_secret_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_github_integration_secrets_updated_at
  before update on public.github_integration_secrets
  for each row execute function public.handle_updated_at();

-- RLS on, NO policies: fail-closed for every client role. Only the
-- service role (which bypasses RLS) can access this table, server-side.
alter table public.github_integration_secrets enable row level security;

grant all on public.github_integration_secrets to service_role;

comment on table public.github_integration_secrets is
  'Encrypted integration secrets. RLS enabled with no policies — service-role only, never exposed to clients.';

create table public.github_workflow_dispatches (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.github_integrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  dispatched_by uuid not null references auth.users (id) on delete cascade,
  ref text not null,
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'requested', 'in_progress', 'completed', 'dispatch_failed')),
  conclusion text,
  github_run_id bigint,
  github_run_url text,
  head_sha text,
  error text,
  status_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_github_dispatches_project on public.github_workflow_dispatches (project_id, created_at desc);
create index idx_github_dispatches_run on public.github_workflow_dispatches (github_run_id);

create trigger trg_github_dispatches_updated_at
  before update on public.github_workflow_dispatches
  for each row execute function public.handle_updated_at();

alter table public.github_workflow_dispatches enable row level security;

create policy "Members can view workflow dispatches"
  on public.github_workflow_dispatches for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can create workflow dispatches"
  on public.github_workflow_dispatches for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and dispatched_by = auth.uid());

create policy "Members can update workflow dispatches"
  on public.github_workflow_dispatches for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant select, insert, update on public.github_workflow_dispatches to authenticated;
grant all on public.github_workflow_dispatches to service_role;

comment on table public.github_workflow_dispatches is
  'Manual workflow_dispatch records; status advanced by signed workflow_run webhooks.';

create table public.github_webhook_deliveries (
  delivery_id text primary key,
  event text not null,
  received_at timestamptz not null default now()
);

-- Service-role only (webhook handler): RLS on, no policies, no grants
-- to authenticated at all.
alter table public.github_webhook_deliveries enable row level security;

grant all on public.github_webhook_deliveries to service_role;

comment on table public.github_webhook_deliveries is
  'Processed GitHub webhook delivery ids — duplicate-event protection. Service-role only.';
