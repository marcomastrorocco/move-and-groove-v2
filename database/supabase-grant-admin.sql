-- ============================================================================
-- Move & Groove: make one account the master owner of /admin
-- ============================================================================
--
-- /admin has its own owner sign-in (src/components/AdminLoginGate.tsx). It asks
-- for an email and password and never offers a CREATE ACCOUNT tab, so a visitor
-- who is not the owner is not handed the athlete sign-in.
--
-- `is_admin` on public.profiles is the flag that opens the panel. It is checked
-- in two places, and both matter:
--   * client-side before the panel renders  (src/app/admin/page.tsx)
--   * server-side on every admin API call   (src/lib/supabase/admin.ts)
-- The server-side check is the real gate. The client-side one only decides
-- which screen to draw.
--
-- BEFORE RUNNING: the account must already exist in Supabase Auth. It is a real
-- address, so create it the normal way rather than hand-building an auth row --
-- sign up once at  yoursite.com/auth  with the email below and confirm the
-- link. BLOCK 1 stops with a clear message if the account is not there yet.
--
-- Run in Supabase Dashboard -> SQL Editor. Both blocks are safe to re-run.
-- ============================================================================


-- ============================================================================
-- BLOCK 1 - grant admin to the owner, and to nobody else
-- ============================================================================

-- The flag has no earlier migration in this repo, so create it if missing.
alter table public.profiles add column if not exists is_admin boolean not null default false;

do $$
declare
  -- ---- EDIT THIS ----------------------------------------------------------
  v_owner_email text := 'marcomastroroccobackup@gmail.com';
  -- -------------------------------------------------------------------------
  v_user_id  uuid;
  v_revoked  integer;
begin
  select id into v_user_id from auth.users where lower(email) = lower(v_owner_email);

  if v_user_id is null then
    raise exception
      'No Supabase account for %. Sign up once at yoursite.com/auth with that address, confirm the email, then run this block again.',
      v_owner_email;
  end if;

  insert into public.profiles (id, is_admin)
  values (v_user_id, true)
  on conflict (id) do update set is_admin = true;

  -- Revoke from everyone else. There is exactly one master owner, and an
  -- address granted admin during earlier testing is a live way into the panel.
  -- Comment the next statement out if you deliberately want more than one.
  update public.profiles
     set is_admin = false
   where is_admin is true
     and id <> v_user_id;

  get diagnostics v_revoked = row_count;

  raise notice 'Granted admin to % (revoked from % other account(s))', v_owner_email, v_revoked;
end $$;

-- PostgREST caches the schema; refresh it in case the alter above added the column.
notify pgrst, 'reload schema';


-- ============================================================================
-- BLOCK 2 - verify
-- ============================================================================

-- Expect exactly one row: the owner address, is_admin = true, confirmed = true.
-- A confirmed of false means the signup link was never opened and sign-in will
-- fail with "Email not confirmed" no matter what the flag says.
select
  u.email,
  p.is_admin,
  u.email_confirmed_at is not null as confirmed
from public.profiles p
join auth.users u on u.id = p.id
where p.is_admin is true;
