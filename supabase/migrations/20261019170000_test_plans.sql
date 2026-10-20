-- 20261019170000_test_plans.sql
--
-- Stored AI-generated test plans (template-guided). The plan JSON holds the
-- validated generated cases (title/objective/steps/priority/testType/area);
-- converting a plan creates a suite and draft test cases from it. Plans are
-- data only — a stored plan is never presented as executed coverage.
--
-- Canary: select count(*) from pg_tables
--          where schemaname = 'public' and tablename = 'test_plans';
--          -- expect 1

create table public.test_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) >= 2 and char_length(name) <= 120),
  -- Template registry key, e.g. 'ecommerce' (lib/test-plans/templates.ts).
  template_key text not null check (char_length(template_key) >= 1 and char_length(template_key) <= 60),
  source_kind text not null
    check (source_kind in ('user_story', 'acceptance_criteria', 'testing_request')),
  source_text text not null check (char_length(source_text) <= 8000),
  -- Generation settings chosen by the user (testTypes, coverageAreas,
  -- priorityStrategy, maxCases) — kept so a plan can be explained/regenerated.
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  -- Validated generated plan: { summary, cases: [...] } (generatedPlanSchema).
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  -- Model that produced the plan; null would mean no model was involved.
  model text,
  status text not null default 'draft'
    check (status in ('draft', 'converted')),
  -- Suite created by conversion; null while the plan is still a draft.
  suite_id uuid references public.suites (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_test_plans_workspace_id on public.test_plans (workspace_id);
create index idx_test_plans_project_id on public.test_plans (project_id);
create index idx_test_plans_status on public.test_plans (status);

create trigger trg_test_plans_updated_at
  before update on public.test_plans
  for each row execute function public.handle_updated_at();

alter table public.test_plans enable row level security;

create policy "Workspace members can view test plans"
  on public.test_plans for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create test plans"
  on public.test_plans for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update test plans"
  on public.test_plans for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete test plans"
  on public.test_plans for delete to authenticated
  using (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.test_plans to authenticated;
grant all on public.test_plans to service_role;

comment on table public.test_plans is
  'Stored AI-generated test plans. Converting a plan creates draft test cases only; a plan is not coverage.';
comment on column public.test_plans.plan is
  'Validated generated plan JSON: { summary, cases[] } matching generatedPlanSchema.';
