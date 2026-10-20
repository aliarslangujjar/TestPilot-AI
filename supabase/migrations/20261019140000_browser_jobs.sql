-- 20261019140000_browser_jobs.sql
--
-- Queue for the standalone Playwright worker (workers/playwright/).
-- The web app enqueues validated plans; the worker claims jobs
-- atomically, executes them in isolated browser contexts, and writes
-- back sanitized results. The worker authenticates with the service-role
-- key (bypasses RLS) and re-validates everything itself: payload,
-- workspace authorization, run limits, and target allowlists.
--
-- Idempotency: (workspace_id, idempotency_key) is unique — re-enqueueing
-- the same key returns the existing job instead of duplicating work.
-- Leases: a claimed job carries lease_expires_at; the worker heartbeats
-- it while running. Crashed workers leave stale leases behind, which the
-- next worker reaps back to `queued` (or `failed` when attempts are
-- exhausted). Cancellation is cooperative: members set cancel_requested
-- and the worker checks it between steps.

create table public.browser_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  plan jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 2 check (max_attempts between 1 and 5),
  cancel_requested boolean not null default false,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  result jsonb,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create index idx_browser_jobs_status_created
  on public.browser_jobs (status, created_at);
create index idx_browser_jobs_workspace_status
  on public.browser_jobs (workspace_id, status);
create index idx_browser_jobs_lease
  on public.browser_jobs (status, lease_expires_at)
  where status = 'running';

create trigger trg_browser_jobs_updated_at
  before update on public.browser_jobs
  for each row execute function public.handle_updated_at();

alter table public.browser_jobs enable row level security;

-- Members see their workspace's jobs (status/result observability).
create policy "Workspace members can view browser jobs"
  on public.browser_jobs for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Members enqueue (the server action validates the plan first).
create policy "Workspace members can enqueue browser jobs"
  on public.browser_jobs for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

-- Members may not update job rows directly: status transitions, leases,
-- retries, and cancellation are owned by the worker (service role) and the
-- cancelBrowserJob server action. This keeps members from forging results
-- or clearing another job's lease via direct UPDATE.
grant select, insert on public.browser_jobs to authenticated;
grant all on public.browser_jobs to service_role;

-- Private bucket for failure screenshots. Paths are
-- <workspace_id>/<job_id>/step-<n>.png. The worker uploads with the
-- service-role key; members read through the policy below (or signed
-- URLs minted server-side).
insert into storage.buckets (id, name, public)
values ('browser-artifacts', 'browser-artifacts', false)
on conflict (id) do nothing;

create policy "Workspace members can read browser artifacts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'browser-artifacts'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );
