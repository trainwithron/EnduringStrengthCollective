-- STEP 155: 0403 Release W3: every client goes through the health form and waiver, whichever door they came in by (a trigger flags someone who joins as a client without a finished form)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: From now on, a person who already had an account and joins a group as a client (by an invite link, or by accepting a coach's invitation) is sent to the health form and waiver on their next page, if they have not finished one. Coaches, social-only members and people who already finished the form are left alone. Nobody who is already in a group is touched.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_trigger where tgname = 'group_memberships_require_intake' and not tgisinternal))) then
    raise exception 'Step 155 (0403) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
