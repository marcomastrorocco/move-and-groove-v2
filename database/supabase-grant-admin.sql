-- ============================================================================
-- Move & Groove: create the single master owner account for /admin
-- ============================================================================
--
-- The owner signs in at livedomain/admin with an OWNER ID and a passcode -- no
-- email address is ever typed or shown. Supabase Auth is email-based
-- underneath, so the ID is mapped onto a reserved domain that never receives
-- mail:  owner  ->  owner@moveandgroove.local
-- That mapping lives in src/lib/admin-identity.ts. Change it in both places or
-- neither.
--
-- Keeping a real Supabase account behind the Owner ID is deliberate: it is what
-- lets requireAdminAccess() in src/lib/supabase/admin.ts keep verifying every
-- /api/admin/* call server-side. A passcode checked only in the browser would
-- protect nothing.
--
-- `is_admin` on public.profiles is the flag that opens the panel. It is checked
-- in two places:
--   * client-side before the panel renders  (src/app/admin/page.tsx)
--   * server-side on every admin API call   (src/lib/supabase/admin.ts)
--
-- HOW TO RUN
--   1. Edit v_owner_id and v_passcode in BLOCK 1 below. Use a long passcode --
--      this one account opens the whole panel.
--   2. Supabase Dashboard -> SQL Editor -> run BLOCK 1, then 2, then 3.
--   3. Delete your edited copy afterwards, or reset the passcode before
--      committing anything. Do not commit a real passcode to git.
--
-- Every block is idempotent. Re-running BLOCK 1 RESETS THE PASSCODE to whatever
-- is written in it -- that is also how you rotate a passcode you have lost.
-- ============================================================================


-- ============================================================================
-- BLOCK 1 - create (or repair) the owner account
-- ============================================================================

-- crypt()/gen_salt() live in the extensions schema on Supabase, in public on
-- some self-hosted projects. Cover both.
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

do $$
declare
  -- ---- EDIT THESE TWO ------------------------------------------------------
  v_owner_id text := 'owner';
  v_passcode text := 'CHANGE-THIS-BEFORE-RUNNING';
  -- -------------------------------------------------------------------------
  v_email           text;
  v_user_id         uuid;
  v_has_provider_id boolean;
begin
  if v_passcode = 'CHANGE-THIS-BEFORE-RUNNING' then
    raise exception 'Set a real passcode in v_passcode before running this block.';
  end if;

  v_email := lower(v_owner_id) || '@moveandgroove.local';

  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, crypt(v_passcode, gen_salt('bf')),
      -- Pre-confirmed: the address is not real, so no confirmation mail can
      -- ever arrive to unlock it.
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Master Owner"}'::jsonb
    );

    raise notice 'Created owner account %', v_email;
  else
    update auth.users
       set encrypted_password = crypt(v_passcode, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at         = now()
     where id = v_user_id;

    raise notice 'Owner account % already existed - passcode reset', v_email;
  end if;

  -- GoTrue refuses a password sign-in without a matching identity row. The
  -- column that carries the provider key was renamed across Supabase versions,
  -- so pick the shape this project actually has.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  if v_has_provider_id then
    execute $q$
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values ($1, $2, jsonb_build_object('sub', $1, 'email', $3), 'email', now(), now(), now())
      on conflict (provider, provider_id) do nothing
    $q$ using v_user_id::text, v_user_id, v_email;
  else
    execute $q$
      insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values ($1, $2, jsonb_build_object('sub', $1, 'email', $3), 'email', now(), now(), now())
      on conflict (provider, id) do nothing
    $q$ using v_user_id::text, v_user_id, v_email;
  end if;
end $$;


-- ============================================================================
-- BLOCK 2 - make that account the ONLY admin
-- ============================================================================

-- The flag predates no migration in this repo, so create it if it is missing.
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Grant. Works whether or not a profile row exists for the owner yet.
insert into public.profiles (id, is_admin)
select u.id, true
from auth.users u
where u.email = 'owner@moveandgroove.local'
on conflict (id) do update set is_admin = true;

-- Revoke from everyone else. There is exactly one master owner, and a personal
-- address granted admin during earlier testing is a live way into the panel.
-- Comment this statement out if you deliberately want more than one admin.
update public.profiles
   set is_admin = false
 where is_admin is true
   and id not in (select id from auth.users where email = 'owner@moveandgroove.local');

-- PostgREST caches the schema; refresh it in case the alter above added the column.
notify pgrst, 'reload schema';


-- ============================================================================
-- BLOCK 3 - verify
-- ============================================================================

-- Expect exactly one row: owner@moveandgroove.local, is_admin = true,
-- has_identity = true. A false has_identity means BLOCK 1 half-ran and sign-in
-- will fail with "Invalid login credentials".
select
  u.email,
  p.is_admin,
  u.email_confirmed_at is not null as confirmed,
  exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') as has_identity
from public.profiles p
join auth.users u on u.id = p.id
where p.is_admin is true;
