-- 20261019130000_test_case_ai_fields.sql
--
-- First-class fields for AI-assisted test cases: the case objective, the
-- coverage class (positive/negative/boundary), and the assumptions the
-- generator recorded. All optional; existing rows are unaffected. The
-- existing table-level RLS policies and grants already cover new columns.

alter table public.test_cases
  add column objective text,
  add column coverage text check (coverage in ('positive', 'negative', 'boundary')),
  add column assumptions text[] not null default '{}';
