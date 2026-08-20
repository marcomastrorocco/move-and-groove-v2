-- Move & Groove: add the saved-workout columns to an existing public.routines table.
--
-- Why this file exists: supabase-routines.sql uses `create table if not exists`,
-- so on a project where public.routines was created before the saved-workout
-- feature landed, that script is a no-op and never adds the newer columns.
-- Symptom in the live app when starring a workout:
--     column routines.saved_at does not exist
--
-- Run once in Supabase Dashboard -> SQL Editor for the production project.
-- Every statement is idempotent, so re-running it is safe.

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

-- PostgREST caches the schema; without this the API keeps reporting the old shape.
notify pgrst, 'reload schema';

-- Verify: expect is_saved and saved_at in the output.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'routines'
order by ordinal_position;
