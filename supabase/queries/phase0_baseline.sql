-- Phase 0 baseline queries. Run in the Supabase SQL editor after the events have collected for 14 days.

-- 1. Daily counts per event.
select date_trunc('day', created_at)::date as day, name, count(*) as n
from public.events
group by 1, 2
order by 1 desc, 2;

-- 2. Share rate: badge_copied per completed scan, last 14 days.
select
  count(*) filter (where name = 'badge_copied')::numeric
  / nullif(count(*) filter (where name = 'scan_completed'), 0) as badge_copies_per_scan,
  count(*) filter (where name = 'scan_completed') as scans,
  count(*) filter (where name = 'badge_copied') as badge_copies
from public.events
where created_at >= now() - interval '14 days';

-- 3. Rescan within 14 days: public repos scanned again by anyone, then by the same signed-in user.
with s as (
  select repo_key, user_id, created_at,
         lag(created_at) over (partition by repo_key order by created_at) as prev_any,
         lag(created_at) over (partition by repo_key, user_id order by created_at) as prev_same_user
  from public.events
  where name = 'scan_completed' and repo_key is not null
)
select
  count(*) as public_repo_scans,
  count(*) filter (where prev_any >= created_at - interval '14 days') as rescans_by_anyone_14d,
  count(*) filter (where user_id is not null and prev_same_user >= created_at - interval '14 days') as rescans_by_same_user_14d
from s
where created_at >= now() - interval '14 days';

-- 4. Distinct signed-in users per day.
select date_trunc('day', created_at)::date as day, count(distinct user_id) as users
from public.events
where name = 'sign_in'
group by 1
order by 1 desc;
