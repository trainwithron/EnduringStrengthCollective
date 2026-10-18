-- Release W3: every NEW client goes through the health form and waiver, whichever door they came in by.
--
-- profiles.intake_required is what sends a client to the form (the app and the sign-in gate read it). It was set only where a brand-new account was made (a coach adding a client, the public booking page, an invite link
-- for someone with no account). A person who ALREADY had an account and joined a group (by an invite link, or by accepting a coach's invitation to a one-on-one space) was never flagged, so they could reach their group
-- without the form. The date of birth is asked of every client-only account separately (the birthday step), so it already covered every door.
--
-- This adds a trigger on a new training membership: the person is flagged only if they are genuinely NEW as a client. Not flagged: anyone who already has another training membership (so a season roll-over, which copies
-- the same people into a new group, flags nobody; a move between groups is an update and never fires this), anyone who coaches a group, anyone who belongs to an organization as its owner, admin or coach, anyone on an
-- organization's front desk, a social-only member, someone who has already finished the form (one form for all of a person's groups), and someone already flagged. Clients who joined earlier and never finished the form are
-- NOT touched here: flagging them is a separate decision. If anything in the trigger goes wrong the membership is still made (a warning is logged). Additions only: a function and a trigger. Re-runnable.
create or replace function public.require_intake_for_new_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_role text := current_setting('request.jwt.claim.role', true);
  v_front_desk boolean := false;
begin
  begin
    if new.role is distinct from 'athlete' or new.membership_type is distinct from 'training' then
      return new;
    end if;
    -- anyone who coaches anywhere, or who runs or works in an organization, is staff using the app, not a new client
    if exists (select 1 from public.group_memberships c where c.profile_id = new.profile_id and c.role = 'coach') then
      return new;
    end if;
    if exists (select 1 from public.organization_memberships o where o.profile_id = new.profile_id) then
      return new;
    end if;
    if to_regclass('public.org_front_desk') is not null then
      execute 'select exists (select 1 from public.org_front_desk f where f.profile_id = $1)' into v_front_desk using new.profile_id;
      if v_front_desk then
        return new;
      end if;
    end if;
    -- already a client somewhere (a new season copying the same people, an extra group): not new
    if exists (select 1 from public.group_memberships m where m.profile_id = new.profile_id and m.id <> new.id and m.role = 'athlete' and m.membership_type = 'training') then
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
  exception when others then
    -- a problem here must never cost a client their membership
    perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
    raise warning 'require_intake_for_new_client: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.require_intake_for_new_client() from public, anon, authenticated;
drop trigger if exists group_memberships_require_intake on public.group_memberships;
create trigger group_memberships_require_intake
  after insert on public.group_memberships
  for each row execute function public.require_intake_for_new_client();
