-- Phase 2 item 5.4: one baseline per user and repo, for "new since baseline". Run once in the
-- Supabase SQL editor of EACH project (production and preview), before the code that writes it is
-- deployed.
--
-- A baseline keeps no code, paths or messages: only finding GROUPS, i.e. for each finding
-- fingerprint hash (api/_lib/fingerprint.js) how many findings had it, e.g. {"<24 hex>": 3}. That is
-- all "is this finding new?" needs, and it stays small (at most 5000 groups, enforced in
-- api/_lib/baseline.js). It is kept separate from user_scans, whose full reports are evicted after
-- the user's fifth scan. Rows are removed with the account. Writes come only from api/baseline.js
-- with the service-role key; a signed-in user can read only their own row. No client can insert,
-- update or delete.

create table if not exists public.scan_baselines (
  user_id        uuid not null references auth.users (id) on delete cascade,
  repo_key       text not null check (char_length(repo_key) <= 140),
  scan_id        uuid not null,
  engine_version text check (engine_version is null or char_length(engine_version) <= 20),
  health_score   numeric(5, 2) check (health_score is null or health_score between 0 and 100),
  finding_count  integer not null default 0 check (finding_count >= 0),
  groups         jsonb not null default '{}'::jsonb check (jsonb_typeof(groups) = 'object'),
  scanned_at     timestamptz not null,
  set_at         timestamptz not null default now(),
  primary key (user_id, repo_key)
);

alter table public.scan_baselines enable row level security;

drop policy if exists scan_baselines_select_own on public.scan_baselines;
create policy scan_baselines_select_own on public.scan_baselines
  for select to authenticated
  using (user_id = (select auth.uid()));
