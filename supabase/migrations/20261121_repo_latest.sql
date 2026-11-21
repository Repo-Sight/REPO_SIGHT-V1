-- Phase 1, item 1: latest PUBLIC scan per repository, so the README badge and the
-- scorecard follow the repo instead of freezing on one scan.
-- Run once in the Supabase SQL editor of EACH project (production and preview).
--
-- Only public-repo scans of the default branch are written (api/analyze.js). Private
-- repos never get a row, so the badge cannot reveal them. Writes use the service-role
-- key; RLS is on with no policies, so anon and authenticated roles cannot touch it.
-- To take a repo's badge and scorecard down on request:
--   update public.repo_latest set removed = true where repo_key = 'owner/repo';

create table if not exists public.repo_latest (
  repo_key     text primary key check (char_length(repo_key) <= 140 and repo_key = lower(repo_key)),
  scan_id      uuid not null,
  health_grade text not null check (health_grade in ('A', 'B', 'C', 'D', 'F')),
  health_score numeric not null check (health_score >= 0 and health_score <= 100),
  scanned_at   timestamptz not null default now(),
  removed      boolean not null default false
);

alter table public.repo_latest enable row level security;
