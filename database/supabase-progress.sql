-- Move & Groove: completed-workout progress used by dashboard totals and weekly load.
-- Run once in Supabase Dashboard -> SQL Editor for the production project.

create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id bigint references public.routines(id) on delete set null,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 45),
  completed_at timestamptz not null default now(),
  sport text,
  areas text[],
  goal text,
  created_at timestamptz not null default now()
);

-- The create-table statement above is a no-op on a project where public.progress
-- already exists, so a constraint tightened or relaxed after the first release
-- has to be reapplied explicitly. This one started life as
-- `check (duration_minutes in (20, 30, 45))`; leaving that in place rejects
-- every other duration the quiz slider offers, and the workout silently fails
-- to reach the dashboard.
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
      and pg_get_constraintdef(con.oid) like '%duration_minutes%'
  loop
    execute format('alter table public.progress drop constraint %I', existing_constraint);
  end loop;
end $$;

alter table public.progress
  add constraint progress_duration_minutes_check
  check (duration_minutes > 0 and duration_minutes <= 45);

alter table public.progress add column if not exists created_at timestamptz not null default now();
alter table public.progress add column if not exists routine_id bigint references public.routines(id) on delete set null;
alter table public.progress add column if not exists completed_at timestamptz not null default now();
alter table public.progress add column if not exists sport text;
alter table public.progress add column if not exists areas text[];
alter table public.progress add column if not exists goal text;

create index if not exists progress_user_completed_at_idx
  on public.progress (user_id, completed_at desc);

alter table public.progress enable row level security;

drop policy if exists "Users can read their own progress" on public.progress;
create policy "Users can read their own progress"
  on public.progress for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can create their own progress" on public.progress;
create policy "Users can create their own progress"
  on public.progress for insert to authenticated
  with check (user_id = auth.uid());

-- Refresh PostgREST so the new table is available to the API immediately.
notify pgrst, 'reload schema';
