-- 20261019160000_failure_analysis.sql
--
-- Persists failure analysis (AI or rule-based fallback) on run results.
-- The analysis is advisory only: it never changes outcomes, and its
-- `source` column records whether a model produced it ('ai') or the
-- deterministic no-AI fallback did ('fallback').

alter table public.run_results
  add column failure_analysis jsonb,
  add column failure_analysis_source text
    check (failure_analysis_source in ('ai', 'fallback')),
  add column failure_analyzed_at timestamptz;
