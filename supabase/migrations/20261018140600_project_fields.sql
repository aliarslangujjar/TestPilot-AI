-- 20261018140600_project_fields.sql
--
-- Project CRUD fields: the authorized base URL a project's tests run
-- against (stored only — the app never fetches it) and an archive flag
-- for soft-hiding projects without deleting history.
--
-- Canary: select count(*) from information_schema.columns
--          where table_schema = 'public' and table_name = 'projects'
--          and column_name in ('base_url', 'is_archived');
--          -- expect 2

alter table public.projects
  add column base_url text,
  add column is_archived boolean not null default false;

-- Defense in depth alongside the zod schema: only http(s) URLs, if set.
alter table public.projects
  add constraint projects_base_url_http
  check (base_url is null or base_url ~ '^https?://');

comment on column public.projects.base_url is
  'Authorized base URL for the project under test. Stored as data only; never fetched by the app.';
comment on column public.projects.is_archived is
  'Soft-archive flag. Archived projects are hidden from the default list but never deleted.';
