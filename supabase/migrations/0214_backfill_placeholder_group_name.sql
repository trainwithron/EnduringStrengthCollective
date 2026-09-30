-- group_structure_and_workflow_usability_audit_sept29.md root cause #3 —
-- a coach creating a new 1-on-1 client via the invite-link path (no name
-- known yet) falls back to the literal group name "New 1-on-1 client"
-- (add-client-button.tsx). That name then persists forever unless a
-- coach happens to notice and manually rename it. The real name IS known
-- the moment the invited person actually joins (group_memberships gets a
-- real athlete row) — this trigger closes that loop automatically.
--
-- Security-definer, not an RLS grant: the joining athlete has no update
-- permission on groups.name (groups_update_coach requires is_group_coach),
-- and shouldn't gain one just for this — the trigger is the correct way
-- to let one specific, narrow system behavior bypass that boundary.
create or replace function public.backfill_placeholder_group_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_name text;
  v_athlete_name text;
begin
  if new.role = 'athlete' then
    select name into v_current_name from public.groups where id = new.group_id;
    if v_current_name = 'New 1-on-1 client' then
      select full_name into v_athlete_name from public.profiles where id = new.profile_id;
      if v_athlete_name is not null then
        update public.groups set name = v_athlete_name where id = new.group_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_backfill_placeholder_group_name
  after insert on public.group_memberships
  for each row execute function public.backfill_placeholder_group_name();
