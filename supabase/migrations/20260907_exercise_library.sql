create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null check (area in ('hips', 'shoulders', 'spine')),
  phase text not null check (phase in ('release', 'activation', 'range', 'foam_roll')),
  sets integer not null default 1 check (sets >= 1),
  reps integer,
  hold_seconds integer,
  movement_pattern text check (movement_pattern is null or movement_pattern in ('rotational', 'linear', 'lateral')),
  anatomical_quadrants text[] not null default '{}',
  rationale text not null default '',
  study_citation text not null default '',
  aliases text[] not null default '{}',
  youtube_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_reps_or_hold check (
    (reps is not null and hold_seconds is null) or
    (reps is null and hold_seconds is not null)
  ),
  constraint exercises_reps_minimum check (reps is null or reps >= 6),
  constraint exercises_hold_minimum check (hold_seconds is null or hold_seconds >= 20)
);

create index if not exists exercises_active_area_phase_name_idx
  on public.exercises (area, phase, name) where is_active = true;
create unique index if not exists exercises_name_area_phase_unique_idx
  on public.exercises (name, area, phase);

create or replace function public.set_exercises_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists exercises_set_updated_at on public.exercises;
create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function public.set_exercises_updated_at();

alter table public.exercises enable row level security;

drop policy if exists exercises_select_authenticated on public.exercises;
create policy exercises_select_authenticated on public.exercises
for select to authenticated using (true);

-- Admin API routes use the Supabase service-role key, which bypasses RLS.
-- No client-side write policy is intentionally created.
