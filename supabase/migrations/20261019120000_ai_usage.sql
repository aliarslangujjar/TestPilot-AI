-- 20261019120000_ai_usage.sql
--
-- Per-workspace AI usage accounting: one row per workspace per calendar day.
-- Drives the daily request/token quotas enforced by lib/ai and keeps the
-- usage log. Writes go through the service-role client only (no
-- insert/update/delete policies for authenticated → fails closed); members
-- can read their own workspace's rows.

create table public.ai_usage (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  period date not null default current_date,
  request_count integer not null default 0 check (request_count >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, period)
);

create index idx_ai_usage_workspace_id on public.ai_usage (workspace_id);

create trigger trg_ai_usage_updated_at
  before update on public.ai_usage
  for each row execute function public.handle_updated_at();

alter table public.ai_usage enable row level security;

create policy "Workspace members can view AI usage"
  on public.ai_usage for select to authenticated
  using (public.is_workspace_member(workspace_id));

grant select on public.ai_usage to authenticated;
grant all on public.ai_usage to service_role;
