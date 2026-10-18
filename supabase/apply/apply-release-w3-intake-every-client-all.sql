-- RELEASE W3 (EVERY CLIENT REACHES THE HEALTH FORM, WHICHEVER DOOR THEY CAME IN BY; ADDS A TRIGGER ONLY, SAFE BEFORE OR WITH THE CODE): ONE paste. Steps 155 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 155: From now on, a person who already had an account and joins a group as a client (by an invite link, or by accepting a coach's invitation) is sent to the health form and waiver on their next page, if they have not finished one. Coaches, social-only members and people who already finished the form are left alone. Nobody who is already in a group is touched.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release W3 (every client reaches the health form, whichever door they came in by; adds a trigger only, safe before or with the code), step 155: 0403 Release W3: every client goes through the health form and waiver, whichever door they came in by (a trigger flags someone who joins as a client without a finished form)
do $g155$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0403 is not already applied (the trigger is not there yet)', not exists (select 1 from pg_trigger where tgname = 'group_memberships_require_intake' and not tgisinternal)),
      ('the tables it reads exist', to_regclass('public.group_memberships') is not null and to_regclass('public.client_intake') is not null and to_regclass('public.profiles') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release W3 (every client reaches the health form, whichever door they came in by; adds a trigger only, safe before or with the code), step 155 (0403) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g155$;

-- ====================================================================================================
-- migration 0403_intake_for_every_client.sql
-- ====================================================================================================

-- Release W3: every client goes through the health form and waiver, whichever door they came in by.
--
-- profiles.intake_required is what sends a client to the form (the app and the sign-in gate read it). It was set only where a brand-new account was made (a coach adding a client, the public booking page, an invite link
-- for someone with no account). A person who ALREADY had an account and joined a group (by an invite link, or by accepting a coach's invitation to a one-on-one space) was never flagged, so they could reach their group
-- without the form. The date of birth is asked of every client-only account separately (the birthday step), so it already covered every door.
--
-- This adds a trigger on a new training membership: if the person is joining as a client, coaches nowhere, has no finished health form and is not already flagged, they are flagged. A coach using the app as their own
-- client is a coach and is left alone; a social-only member is left alone; someone who has already finished the form (it is one form for all of a person's groups) is left alone. Additions only: a function and a trigger.
-- Re-runnable.
create or replace function public.require_intake_for_new_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_role text := current_setting('request.jwt.claim.role', true);
begin
  if new.role is distinct from 'athlete' or new.membership_type is distinct from 'training' then
    return new;
  end if;
  if exists (select 1 from public.group_memberships c where c.profile_id = new.profile_id and c.role = 'coach') then
    return new;
  end if;
  if exists (select 1 from public.client_intake i where i.athlete_id = new.profile_id and i.completed_at is not null) then
    return new;
  end if;
  if exists (select 1 from public.profiles p where p.id = new.profile_id and p.intake_required) then
    return new;
  end if;
  -- the sign-in-sensitive columns of profiles are guarded against a signed-in person's own writes; this write is the system's
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.profiles set intake_required = true where id = new.profile_id;
  perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
  return new;
end;
$$;
revoke execute on function public.require_intake_for_new_client() from public, anon, authenticated;
drop trigger if exists group_memberships_require_intake on public.group_memberships;
create trigger group_memberships_require_intake
  after insert on public.group_memberships
  for each row execute function public.require_intake_for_new_client();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 155 (0403)' as step, '0403 Release W3: every client goes through the health form and waiver' as what, not ((not exists (select 1 from pg_trigger where tgname = 'group_memberships_require_intake' and not tgisinternal))) as in_place
) as result order by step;
