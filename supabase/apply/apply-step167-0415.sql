-- STEP 167: 0415 Release AF3e paste A: minor_may_write(), the one question 'may this person write things other people will see?' (function only; nothing uses it yet)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen and no policy uses the function yet. Adds two small read-only functions.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.minor_may_write(uuid)') is null)) then
    raise exception 'Step 167 (0415) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0415_minor_may_write.sql
-- ====================================================================================================

-- Release AF3 (e), paste A: the question "may this person write things other people will see?" as one database function. NOTHING uses it yet (paste B puts it on `posts`, paste C on the rest), so this file
-- changes no behaviour by itself. Additions only: two functions with new names. Re-runnable.
--
-- minor_may_write(user) mirrors lib/dob-gate.ts (the page gate) and the API guard, so the database says the same thing the screens say:
--   * no athlete seat anywhere, or any coach seat                                  -> true (a coach, or someone who is not a client)
--   * athlete seat, staff (organization role or front-desk seat) whose YOUNGEST date on file (intake date or profile birthday) is 18 or older, or who has no date -> true
--   * otherwise a client: no date of birth in client_intake -> false (unknown age counts as not an adult); under 13 -> false; 13 to 17 -> true only with a signed guardian consent; 18 or older -> true.
-- It reads only, never raises, and has no side effects. Age uses the same calendar rule as lib/coppa.ts: the birthday in year N is the same month and day, and a 29 February birthday counts from 1 March in a year
-- that has none (that is what the JavaScript date does), so a person is the same age on both sides.

-- The date a person turns n: same month and day n years later; 29 February in a year without one becomes 1 March (JavaScript's Date overflow, which the page gate uses).
create or replace function public.age_threshold_date(p_dob date, p_years integer)
returns date
language sql
immutable
set search_path = public
as $$
  select make_date((extract(year from p_dob))::int + p_years, (extract(month from p_dob))::int, 1) + ((extract(day from p_dob))::int - 1)
$$;

create or replace function public.minor_may_write(p_user uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_coach boolean;
  v_has_athlete boolean;
  v_staff boolean;
  v_intake_dob date;
  v_profile_birthday date;
  v_youngest date;
  v_today date := current_date;
begin
  if p_user is null then
    return false;
  end if;

  select coalesce(bool_or(role = 'coach'), false), coalesce(bool_or(role = 'athlete'), false)
    into v_has_coach, v_has_athlete
  from public.group_memberships
  where profile_id = p_user;

  -- someone who is not a client, or who also coaches, is never asked
  if v_has_coach or not v_has_athlete then
    return true;
  end if;

  select exists (select 1 from public.organization_memberships where profile_id = p_user)
      or exists (select 1 from public.org_front_desk where profile_id = p_user)
    into v_staff;

  select date_of_birth into v_intake_dob from public.client_intake where athlete_id = p_user limit 1;
  select birthday into v_profile_birthday from public.athlete_profile_details where athlete_id = p_user limit 1;
  v_youngest := greatest(v_intake_dob, v_profile_birthday);

  -- staff pass unless a date on file shows they are under 18 (staff status never switches off the age rules for a known minor)
  if v_staff and (v_youngest is null or v_today >= public.age_threshold_date(v_youngest, 18)) then
    return true;
  end if;

  -- a client: the date of birth in client_intake is the one place the age rules read
  if v_intake_dob is null then
    return false;
  end if;
  if v_today < public.age_threshold_date(v_intake_dob, 13) then
    return false;
  end if;
  if v_today < public.age_threshold_date(v_intake_dob, 18) then
    return exists (select 1 from public.guardian_consents where athlete_id = p_user and status = 'signed');
  end if;
  return true;
end;
$$;

revoke all on function public.age_threshold_date(date, integer) from public, anon;
grant execute on function public.age_threshold_date(date, integer) to authenticated, service_role;
revoke all on function public.minor_may_write(uuid) from public, anon;
grant execute on function public.minor_may_write(uuid) to authenticated, service_role;

commit;
