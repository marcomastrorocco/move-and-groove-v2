-- ============================================================================
-- Move & Groove - run this once in Supabase Dashboard -> SQL Editor
-- ============================================================================
--
-- Paste the whole file and press Run. Every statement is idempotent, so running
-- it twice is safe and values an admin has already set are preserved.
--
-- STEP 1 and STEP 2 both exist because the schema files use
-- `create table if not exists`. On a project where the table already exists
-- those scripts do nothing, so anything added or changed after the table was
-- first created never reached the live database.
--
--   STEP 1  "column routines.saved_at does not exist" when starring a workout
--   STEP 2  completed workouts never reaching the dashboard: the live progress
--           table still carries check (duration_minutes in (20, 30, 45)) while
--           the quiz slider offers 15/20/25/30/35/40/45, so any other value is
--           rejected on insert
--   STEP 3  creates app_config, which holds the admin-editable limits
--   STEP 4  raises the daily workout cap so completed sessions keep counting
--   STEP 5  verification queries - read the output to confirm each step
--
-- STEP 6 and STEP 7 are optional and commented out. Read them before using.
--
-- After running this, redeploy the site from main. The database change alone is
-- not enough: the code that reads these values ships in the deploy.
-- ============================================================================


-- ============================================================================
-- STEP 1 - saved-workout columns on public.routines
-- ============================================================================

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
-- STEP 2 - workout duration constraint on public.progress
-- ============================================================================
-- Drops whatever check constraint the live table has on duration_minutes and
-- reapplies the current one. The loop avoids having to guess its name.

do $$
declare
  existing_constraint text;
begin
  for existing_constraint in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'progress'
      and con.contype = 'c'
      and pg_get_constraintdef(con) like '%duration_minutes%'
  loop
    execute format('alter table public.progress drop constraint %I', existing_constraint);
  end loop;
end $$;

alter table public.progress
  add constraint progress_duration_minutes_check
  check (duration_minutes > 0 and duration_minutes <= 45);

alter table public.progress add column if not exists routine_id bigint references public.routines(id) on delete set null;
alter table public.progress add column if not exists completed_at timestamptz not null default now();
alter table public.progress add column if not exists sport text;
alter table public.progress add column if not exists areas text[];
alter table public.progress add column if not exists goal text;


-- ============================================================================
-- STEP 3 - app_config, the admin-editable limits
-- ============================================================================

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

insert into public.app_config (key, value)
values
  ('basic_daily_routine_limit', '2'),
  ('daily_workout_limit', '2')
on conflict (key) do nothing;


-- ============================================================================
-- STEP 4 - raise the daily workout cap
-- ============================================================================
-- Change '20' to whatever you want. After the deploy this is editable from the
-- admin panel instead of here.

update public.app_config
set value = '20', updated_at = now()
where key = 'daily_workout_limit';


-- PostgREST caches the schema. Without this the API keeps reporting the old
-- shape even though the columns now exist.
notify pgrst, 'reload schema';


-- ============================================================================
-- STEP 5 - verification
-- ============================================================================

-- Expect is_saved and saved_at.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'routines'
  and column_name in ('is_saved', 'saved_at');

-- Expect: duration_minutes > 0 AND duration_minutes <= 45
-- If it still shows in (20, 30, 45), STEP 2 did not apply.
select con.conname, pg_get_constraintdef(con) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and rel.relname = 'progress' and con.contype = 'c';

-- Expect both keys, with daily_workout_limit at the value set in STEP 4.
select key, value, updated_at
from public.app_config
order by key;


-- ============================================================================
-- STEP 6 (OPTIONAL) - what has been logged today
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
-- STEP 7 (OPTIONAL, DESTRUCTIVE) - clear one account's rows for today
-- ============================================================================
-- Only needed to reset a day's count instead of raising the cap. This DELETES
-- rows permanently and cannot be undone. Run STEP 6 first and read the output,
-- so you know exactly what this will remove.
--
-- delete from public.progress p
-- using auth.users u
-- where u.id = p.user_id
--   and u.email = 'REPLACE_WITH_YOUR_EMAIL'
--   and p.completed_at >= date_trunc('day', now() at time zone 'utc');
