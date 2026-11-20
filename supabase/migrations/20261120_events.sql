-- Phase 0 (G0): usage events for the retention baseline.
-- Run once in the Supabase SQL editor of EACH project (production and preview).
--
-- Privacy: no IP address, user agent or browser identifier is stored. user_id is set only for
-- signed-in users; repo_key only for scans of PUBLIC repos ("owner/repo", lowercase).
-- Writes come from the serverless functions with the service-role key. RLS is on with no
-- policies, so the anon and authenticated roles cannot read or write this table.

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text not null check (name in ('scan_completed', 'badge_copied', 'sign_in')),
  user_id    uuid,
  repo_key   text check (repo_key is null or char_length(repo_key) <= 140),
  meta       jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 1024)
);

create index if not exists events_name_created_idx on public.events (name, created_at desc);
create index if not exists events_repo_created_idx on public.events (repo_key, created_at) where repo_key is not null;

alter table public.events enable row level security;
