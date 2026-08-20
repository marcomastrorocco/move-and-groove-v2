-- Move & Groove: grant unlimited access to a single account.
--
-- `is_pro` is the existing entitlement flag. It bypasses:
--   * the daily routine-generation cap  (src/app/api/routines/generate/route.ts)
--   * the daily workout-completion cap  (src/app/api/progress/route.ts)
--
-- Run in Supabase Dashboard -> SQL Editor, with the email replaced below.
-- Safe to re-run.

-- 1. Make sure the flag exists (older projects may predate it).
alter table public.profiles add column if not exists is_pro boolean not null default false;

-- 2. Flip it on for one account. Works whether or not a profile row exists yet.
insert into public.profiles (id, is_pro)
select u.id, true
from auth.users u
where u.email = 'REPLACE_WITH_YOUR_EMAIL'
on conflict (id) do update set is_pro = true;

-- 3. PostgREST caches the schema; refresh it if step 1 added the column.
notify pgrst, 'reload schema';

-- 4. Verify: expect exactly the accounts you intend to be unlimited.
select u.email, p.is_pro
from public.profiles p
join auth.users u on u.id = p.id
where p.is_pro is true;
