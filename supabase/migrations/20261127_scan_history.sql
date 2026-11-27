-- Phase 2 item 5: compact per-scan history for trends. Run once in the Supabase SQL editor of
-- EACH project (production and preview), before the code that writes it is deployed.
--
-- One small row per scan of a signed-in user (about 200 bytes; no code, paths or findings), kept
-- after the full report is evicted from user_scans' five-scan window. Rows are removed with the
-- account. Writes come from the serverless functions with the service-role key; a signed-in user
-- can read only their own rows (for the trend chart). No client can insert, update or delete.

create table if not exists public.scan_history (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users (id) on delete cascade,
  repo_key              text not null check (char_length(repo_key) <= 140),
  scan_id               uuid not null unique,
  commit_sha            text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40}$'),
  branch                text check (branch is null or char_length(branch) <= 100),
  engine_version        text not null check (char_length(engine_version) <= 20),
  health_score          numeric(5, 2) not null check (health_score between 0 and 100),
  health_grade          text check (health_grade is null or char_length(health_grade) <= 2),
  score_complexity      numeric(5, 2) check (score_complexity is null or score_complexity between 0 and 100),
  score_function_length numeric(5, 2) check (score_function_length is null or score_function_length between 0 and 100),
  score_comments        numeric(5, 2) check (score_comments is null or score_comments between 0 and 100),
  score_todo            numeric(5, 2) check (score_todo is null or score_todo between 0 and 100),
  score_nesting         numeric(5, 2) check (score_nesting is null or score_nesting between 0 and 100),
  tier_critical         integer not null default 0 check (tier_critical >= 0),
  tier_high             integer not null default 0 check (tier_high >= 0),
  tier_medium           integer not null default 0 check (tier_medium >= 0),
  tier_low              integer not null default 0 check (tier_low >= 0),
  files_analyzed        integer not null default 0 check (files_analyzed >= 0),
  total_lines           integer not null default 0 check (total_lines >= 0),
  partial               boolean not null default false,
  scanned_at            timestamptz not null default now()
);

create index if not exists scan_history_user_repo_time_idx
  on public.scan_history (user_id, repo_key, scanned_at desc);

alter table public.scan_history enable row level security;

drop policy if exists scan_history_select_own on public.scan_history;
create policy scan_history_select_own on public.scan_history
  for select to authenticated
  using (user_id = (select auth.uid()));
