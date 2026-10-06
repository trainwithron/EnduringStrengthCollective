-- STEP 06: 0251 kiosk PINs stored hashed with a five-wrong-tries lockout
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Existing kiosk PINs still work (they are copied across hashed). Then run supabase/ron-test-kiosk-checkin.md BEFORE the next step (0252, which removes the old plain-text column).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.kiosk_pins') is null)) then
    raise exception 'Step 06 (0251) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0251_kiosk_pins_hashed.sql
-- ====================================================================================================

-- Kiosk check-in PINs, stored hashed with a lockout.
--
-- Until now group_memberships.kiosk_pin held the 4-digit PIN in plain text, readable by every member of the group
-- (the policy that lets members see the roster lets them see that column), and /api/kiosk/checkin had no limit on
-- wrong guesses. Now:
--   * PINs live hashed in kiosk_pins, which no client can read (no policies).
--   * The coach sets a PIN through set_kiosk_pin and sees it once, at the moment it is generated; it cannot be read back.
--   * Checking a PIN goes through verify_kiosk_pin, which counts wrong tries per athlete: five wrong tries lock that
--     athlete's PIN for 15 minutes, then an hour, then a day, and a right PIN clears the count.
-- Existing PINs are copied across hashed. The plain column stays for now so already-deployed code keeps working; it is
-- removed by 0252, which must be applied AFTER the new code is deployed.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.kiosk_pins (
  group_id uuid not null references public.groups(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  lock_count int not null default 0,
  locked_until timestamptz,
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (group_id, athlete_id)
);

alter table public.kiosk_pins enable row level security;
-- No policies on purpose: only the functions below touch it.

insert into public.kiosk_pins (group_id, athlete_id, pin_hash)
select gm.group_id, gm.profile_id, extensions.crypt(gm.kiosk_pin, extensions.gen_salt('bf'))
from public.group_memberships gm
where gm.kiosk_pin is not null and gm.role = 'athlete'
on conflict (group_id, athlete_id) do nothing;

create or replace function public.set_kiosk_pin(p_group_id uuid, p_athlete_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to set kiosk PINs';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'a kiosk PIN is 4 digits';
  end if;
  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete'
  ) then
    raise exception 'that person is not an athlete in this group';
  end if;

  insert into public.kiosk_pins (group_id, athlete_id, pin_hash, set_by)
  values (p_group_id, p_athlete_id, extensions.crypt(p_pin, extensions.gen_salt('bf')), auth.uid())
  on conflict (group_id, athlete_id) do update
    set pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        lock_count = 0,
        locked_until = null,
        set_by = auth.uid(),
        set_at = now();
end;
$$;
grant execute on function public.set_kiosk_pin(uuid, uuid, text) to authenticated;

-- Which athletes in the group have a PIN. Never returns a PIN or a hash.
create or replace function public.kiosk_pin_status(p_group_id uuid)
returns table(athlete_id uuid, has_pin boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized';
  end if;
  return query select kp.athlete_id, true from public.kiosk_pins kp where kp.group_id = p_group_id;
end;
$$;
grant execute on function public.kiosk_pin_status(uuid) to authenticated;

-- 'ok', 'wrong', 'locked' or 'no_pin'. Returns instead of raising so the wrong-try count is kept.
create or replace function public.verify_kiosk_pin(p_group_id uuid, p_athlete_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kiosk_pins%rowtype;
  v_lock_count int;
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to check kiosk PINs';
  end if;

  select * into v_row from public.kiosk_pins
  where group_id = p_group_id and athlete_id = p_athlete_id
  for update;
  if not found then
    return 'no_pin';
  end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return 'locked';
  end if;

  if p_pin is not null and v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash) then
    update public.kiosk_pins
      set failed_attempts = 0, lock_count = 0, locked_until = null
      where group_id = p_group_id and athlete_id = p_athlete_id;
    return 'ok';
  end if;

  if v_row.failed_attempts + 1 >= 5 then
    v_lock_count := v_row.lock_count + 1;
    update public.kiosk_pins
      set failed_attempts = 0,
          lock_count = v_lock_count,
          locked_until = now() + case v_lock_count when 1 then interval '15 minutes' when 2 then interval '1 hour' else interval '24 hours' end
      where group_id = p_group_id and athlete_id = p_athlete_id;
    return 'locked';
  end if;

  update public.kiosk_pins set failed_attempts = v_row.failed_attempts + 1
    where group_id = p_group_id and athlete_id = p_athlete_id;
  return 'wrong';
end;
$$;
grant execute on function public.verify_kiosk_pin(uuid, uuid, text) to authenticated;

commit;
