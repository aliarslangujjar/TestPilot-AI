-- 20261019210000_usage_metering.sql
--
-- Workspace usage metering for the (only) free plan — see
-- docs/COST_MODEL.md. One aggregate row per workspace per monthly
-- period (UTC). Counters hold NO per-user or per-request detail.
--
-- Enforcement is race-safe by construction: reserve_usage() takes the
-- counter row's lock (SELECT ... FOR UPDATE) inside one transaction,
-- checks every requested amount against its limit, and only then
-- increments. Concurrent reservations for a workspace serialize on
-- that row lock, so two requests can never both slip past a limit.
--
-- Writes happen only through these SECURITY DEFINER functions, called
-- by the service role after a server-side membership check. Members can
-- SELECT their own counters (usage page); there are no client writes.
--
-- Canary: select count(*) from pg_tables
--          where schemaname = 'public' and tablename = 'usage_counters';
--          -- expect 1

create table public.usage_counters (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  period_start date not null,
  ai_calls bigint not null default 0 check (ai_calls >= 0),
  browser_runs bigint not null default 0 check (browser_runs >= 0),
  execution_seconds bigint not null default 0 check (execution_seconds >= 0),
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, period_start)
);

create trigger trg_usage_counters_updated_at
  before update on public.usage_counters
  for each row execute function public.handle_updated_at();

alter table public.usage_counters enable row level security;

create policy "Members can view workspace usage"
  on public.usage_counters for select to authenticated
  using (public.is_workspace_member(workspace_id));

grant select on public.usage_counters to authenticated;
grant all on public.usage_counters to service_role;

comment on table public.usage_counters is
  'Per-workspace per-period usage aggregates (AI calls, browser runs, execution seconds, storage bytes). Writes only via reserve/release/meter functions.';

create function public.reserve_usage(
  p_workspace_id uuid,
  p_period_start date,
  p_ai_calls bigint,
  p_browser_runs bigint,
  p_execution_seconds bigint,
  p_storage_bytes bigint,
  p_ai_limit bigint,
  p_browser_runs_limit bigint,
  p_execution_seconds_limit bigint,
  p_storage_limit bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ai bigint;
  v_runs bigint;
  v_seconds bigint;
  v_storage bigint;
begin
  insert into public.usage_counters (workspace_id, period_start)
  values (p_workspace_id, p_period_start)
  on conflict (workspace_id, period_start) do nothing;

  select ai_calls, browser_runs, execution_seconds, storage_bytes
    into v_ai, v_runs, v_seconds, v_storage
    from public.usage_counters
   where workspace_id = p_workspace_id and period_start = p_period_start
   for update;

  if (p_ai_calls > 0 and v_ai + p_ai_calls > p_ai_limit)
     or (p_browser_runs > 0 and v_runs + p_browser_runs > p_browser_runs_limit)
     or (p_execution_seconds > 0 and v_seconds + p_execution_seconds > p_execution_seconds_limit)
     or (p_storage_bytes > 0 and v_storage + p_storage_bytes > p_storage_limit)
  then
    return false;
  end if;

  update public.usage_counters
     set ai_calls = ai_calls + p_ai_calls,
         browser_runs = browser_runs + p_browser_runs,
         execution_seconds = execution_seconds + p_execution_seconds,
         storage_bytes = storage_bytes + p_storage_bytes
   where workspace_id = p_workspace_id and period_start = p_period_start;

  return true;
end;
$$;

create function public.release_usage(
  p_workspace_id uuid,
  p_period_start date,
  p_ai_calls bigint,
  p_browser_runs bigint,
  p_execution_seconds bigint,
  p_storage_bytes bigint
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.usage_counters
     set ai_calls = greatest(0, ai_calls - p_ai_calls),
         browser_runs = greatest(0, browser_runs - p_browser_runs),
         execution_seconds = greatest(0, execution_seconds - p_execution_seconds),
         storage_bytes = greatest(0, storage_bytes - p_storage_bytes)
   where workspace_id = p_workspace_id and period_start = p_period_start;
$$;

create function public.meter_usage(
  p_workspace_id uuid,
  p_period_start date,
  p_ai_calls bigint,
  p_browser_runs bigint,
  p_execution_seconds bigint,
  p_storage_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_counters (
    workspace_id, period_start, ai_calls, browser_runs, execution_seconds, storage_bytes
  ) values (
    p_workspace_id, p_period_start, p_ai_calls, p_browser_runs, p_execution_seconds, p_storage_bytes
  )
  on conflict (workspace_id, period_start) do update
     set ai_calls = usage_counters.ai_calls + excluded.ai_calls,
         browser_runs = usage_counters.browser_runs + excluded.browser_runs,
         execution_seconds = usage_counters.execution_seconds + excluded.execution_seconds,
         storage_bytes = usage_counters.storage_bytes + excluded.storage_bytes;
end;
$$;

create function public.set_storage_usage(
  p_workspace_id uuid,
  p_period_start date,
  p_storage_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_counters (workspace_id, period_start, storage_bytes)
  values (p_workspace_id, p_period_start, p_storage_bytes)
  on conflict (workspace_id, period_start) do update
     set storage_bytes = excluded.storage_bytes;
end;
$$;

grant execute on function public.reserve_usage(uuid, date, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.release_usage(uuid, date, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.meter_usage(uuid, date, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.set_storage_usage(uuid, date, bigint) to service_role;
