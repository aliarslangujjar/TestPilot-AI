-- 20261019190000_community_templates.sql
--
-- Community library of reusable QA templates. Published templates are a
-- validated SNAPSHOT of a stored test plan's cases (content jsonb) —
-- decoupled from the author's workspace, so browsing never touches
-- workspace data. Content is untrusted: it is schema-validated and
-- content-scanned at publish time and re-validated at import time.
--
-- Canary: select count(*) from pg_tables
--          where schemaname = 'public'
--            and tablename in ('community_templates', 'community_template_reports');
--          -- expect 2

create table public.community_templates (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references auth.users (id) on delete cascade,
  -- Display name snapshot at publish time (profiles.display_name).
  author_display_name text not null check (char_length(author_display_name) >= 1 and char_length(author_display_name) <= 120),
  name text not null check (char_length(name) >= 2 and char_length(name) <= 120),
  description text not null default '' check (char_length(description) <= 1000),
  app_type text not null
    check (app_type in ('general-web-app', 'ecommerce', 'saas-dashboard', 'auth', 'rest-api', 'content-site', 'custom')),
  license text not null check (license in ('MIT', 'CC-BY-4.0', 'CC0-1.0')),
  tags text[] not null default '{}',
  -- Validated template content: { cases: [...] } (templateContentSchema).
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  case_count integer not null check (case_count >= 0),
  status text not null default 'published' check (status in ('published', 'removed')),
  view_count integer not null default 0 check (view_count >= 0),
  import_count integer not null default 0 check (import_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_community_templates_status on public.community_templates (status);
create index idx_community_templates_author on public.community_templates (author_user_id);
create index idx_community_templates_app_type on public.community_templates (app_type);

create trigger trg_community_templates_updated_at
  before update on public.community_templates
  for each row execute function public.handle_updated_at();

alter table public.community_templates enable row level security;

-- Browse: any signed-in user can read published templates (the community
-- is cross-workspace by design); authors can always read their own.
create policy "Anyone signed in can view published templates"
  on public.community_templates for select to authenticated
  using (status = 'published' or author_user_id = auth.uid());

create policy "Authors can publish templates"
  on public.community_templates for insert to authenticated
  with check (author_user_id = auth.uid());

create policy "Authors can update their templates"
  on public.community_templates for update to authenticated
  using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

create policy "Authors can delete their templates"
  on public.community_templates for delete to authenticated
  using (author_user_id = auth.uid());

grant select, insert, update, delete on public.community_templates to authenticated;
grant all on public.community_templates to service_role;

comment on table public.community_templates is
  'Community QA templates: validated snapshots, cross-workspace read for published rows. Content is untrusted data.';

-- Abuse reports: one per user per template, visible only to the reporter
-- (moderation review is a service-role concern, not a public surface).
create table public.community_template_reports (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.community_templates (id) on delete cascade,
  reporter_user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null
    check (reason in ('spam', 'malicious_content', 'copyright', 'inappropriate', 'other')),
  details text check (char_length(details) <= 500),
  created_at timestamptz not null default now(),
  unique (template_id, reporter_user_id)
);

create index idx_template_reports_template on public.community_template_reports (template_id);

alter table public.community_template_reports enable row level security;

create policy "Users can view their own reports"
  on public.community_template_reports for select to authenticated
  using (reporter_user_id = auth.uid());

create policy "Users can report published templates"
  on public.community_template_reports for insert to authenticated
  with check (
    reporter_user_id = auth.uid()
    and exists (
      select 1 from public.community_templates t
      where t.id = template_id and t.status = 'published'
    )
  );

grant select, insert on public.community_template_reports to authenticated;
grant all on public.community_template_reports to service_role;

comment on table public.community_template_reports is
  'Abuse reports for community templates. Private to the reporter; reviewed via service role.';

-- Usage counters. RLS prevents users from updating other authors'
-- templates, so view/import bumps go through narrow SECURITY DEFINER
-- functions that touch ONLY the counter of a published template.
create function public.bump_community_template_views(p_template_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.community_templates
     set view_count = view_count + 1
   where id = p_template_id and status = 'published';
$$;

create function public.bump_community_template_imports(p_template_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.community_templates
     set import_count = import_count + 1
   where id = p_template_id and status = 'published';
$$;

grant execute on function public.bump_community_template_views(uuid) to authenticated;
grant execute on function public.bump_community_template_imports(uuid) to authenticated;
