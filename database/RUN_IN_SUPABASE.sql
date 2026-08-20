-- ============================================================================
-- Move & Groove - run this once in Supabase Dashboard -> SQL Editor
-- ============================================================================
--
-- Paste the whole file and press Run. Every statement is idempotent, so running
-- it twice is safe and values an admin has already set are preserved.
--
-- Fixes, in order:
--   STEP 1  "column routines.saved_at does not exist" when starring a workout
--   STEP 2  creates app_config, which holds the admin-editable limits
--   STEP 3  raises the daily workout cap so completed sessions keep counting
--   STEP 4  verification queries - read the output to confirm each step
--
-- STEP 5 and STEP 6 are optional and commented out. Read them before using.
--
-- After running this, redeploy the site from main. The database change alone is
-- not enough: the code that reads these values ships in the deploy.
-- ============================================================================


-- ============================================================================
-- STEP 1 - saved-workout columns on public.routines
-- ============================================================================
-- database/supabase-routines.sql creates this table with `if not exists`, so on
-- a project where routines predates the saved-workout feature the script is a
-- no-op and these columns were never added.

alter table public.routines add column if not exists sport text;
alter table public.routines add column if not exists areas text[] not null default '{}';
alter table public.routines add column if not exists goal text;
alter table public.routines add column if not exists duration_minutes integer;
alter table public.routines add column if not exists difficulty text;
alter table public.routines add column if not exists summary text;
alter table public.routines add column if not exists evidence_summary text;
alter table public.routines add column if not exists is_saved boolean not null default false;
alter table public.routines add column if not exists saved_at timestamptz;

create index if not exists routines_user_saved_at_idx
  on public.routines (user_id, saved_at desc)
  where is_saved = true;


-- ============================================================================
-- STEP 2 - app_config, the admin-editable limits
-- ============================================================================
-- Read by the dashboard in the browser and by /api/progress and
-- /api/routines/generate on the server.

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config add column if not exists updated_at timestamptz not null default now();

alter table public.app_config enable row level security;

-- Signed-in users read the limits so the dashboard shows the same numbers the
-- API enforces.
drop policy if exists "Authenticated users can read app config" on public.app_config;
create policy "Authenticated users can read app config"
  on public.app_config for select to authenticated
  using (true);

-- Deliberately NO insert/update/delete policy. Writes go through the service
-- role key in /api/admin/config, behind requireAdminAccess, so a signed-in user
-- cannot raise their own limits from the browser.

-- Seed defaults without overwriting anything already set.
insert into public.app_config (key, value)
values
  ('basic_daily_routine_limit', '2'),
  ('daily_workout_limit', '2')
on conflict (key) do nothing;


-- ============================================================================
-- STEP 3 - raise the daily workout cap
-- ============================================================================
-- This is why a finished workout stopped showing up on the dashboard: the third
-- session of the day was refused. Change '20' to whatever you want. After the
-- deploy you can edit this from the admin panel instead of running SQL.

update public.app_config
set value = '20', updated_at = now()
where key = 'daily_workout_limit';


-- PostgREST caches the schema. Without this the API keeps reporting the old
-- shape even though the columns now exist.
notify pgrst, 'reload schema';


-- ============================================================================
-- STEP 4 - verification
-- ============================================================================

-- Expect is_saved and saved_at in this list.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'routines'
  and column_name in ('is_saved', 'saved_at');

-- Expect both keys, with daily_workout_limit at the value set in STEP 3.
select key, value, updated_at
from public.app_config
order by key;


-- ============================================================================
-- STEP 5 (OPTIONAL) - what has been logged today
-- ============================================================================
-- Replace the email. Run this if the dashboard still shows no time: it tells
-- you whether rows exist at all.
--
-- select p.completed_at, p.duration_minutes, p.routine_id
-- from public.progress p
-- join auth.users u on u.id = p.user_id
-- where u.email = 'REPLACE_WITH_YOUR_EMAIL'
--   and p.completed_at >= date_trunc('day', now() at time zone 'utc')
-- order by p.completed_at desc;


-- ============================================================================
-- STEP 6 (OPTIONAL, DESTRUCTIVE) - clear today's test rows
-- ============================================================================
-- Only needed if you want to reset the day's count instead of raising the cap.
-- This DELETES rows permanently and cannot be undone. Run STEP 5 first and read
-- the output, so you know exactly what this will remove.
--
-- delete from public.progress p
-- using auth.users u
-- where u.id = p.user_id
--   and u.email = 'REPLACE_WITH_YOUR_EMAIL'
--   and p.completed_at >= date_trunc('day', now() at time zone 'utc');
