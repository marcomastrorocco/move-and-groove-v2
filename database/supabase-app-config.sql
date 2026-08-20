-- Move & Groove: admin-editable runtime limits.
--
-- Read by the dashboard (browser, signed-in user) and by server routes such as
-- /api/progress and /api/routines/generate. Written only by /api/admin/config,
-- which runs with the service role key behind requireAdminAccess.
--
-- Run once in Supabase Dashboard -> SQL Editor. Safe to re-run: existing values
-- are preserved.

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config add column if not exists updated_at timestamptz not null default now();

alter table public.app_config enable row level security;

-- Signed-in users need to read the limits so the dashboard shows the same
-- numbers the API enforces.
drop policy if exists "Authenticated users can read app config" on public.app_config;
create policy "Authenticated users can read app config"
  on public.app_config for select to authenticated
  using (true);

-- Deliberately no insert/update/delete policy: writes must go through the
-- service role key in /api/admin/config, so a signed-in user cannot raise their
-- own limits from the browser.

-- Seed the defaults without clobbering values an admin has already set.
insert into public.app_config (key, value)
values
  ('basic_daily_routine_limit', '2'),
  ('daily_workout_limit', '2')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- Verify: expect both keys listed.
select key, value, updated_at from public.app_config order by key;
