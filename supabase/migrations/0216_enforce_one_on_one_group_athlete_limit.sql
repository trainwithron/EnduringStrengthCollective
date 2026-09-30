-- group_kind_enforcement_investigation_sept29.md — the real, hard
-- backstop. Three separate app-level entry points (invite-link join,
-- Add-Client's destination picker, Change-Client-Group's move flow) now
-- have their own pre-checks (checkOneOnOneGroupHasRoom / the widened
-- get_invite_info), but nothing stops a raw insert/update, a future code
-- path, or an admin tool from creating the same violation again. A real
-- production group already hit this exact bug once (confirmed: the same
-- invite code reused by two people) — nothing legitimate in this
-- codebase ever intentionally puts a second athlete in a one_on_one
-- group, so this is a real constraint, not a guess.
--
-- NOT a plain unique/partial index: "at most 1 athlete per one_on_one
-- GROUP" depends on group_kind, which lives on a different table
-- (groups), and a partial index predicate can't reference another
-- table. A trigger is this codebase's own established pattern for
-- exactly this shape of cross-row/cross-table business rule (see
-- backfill_placeholder_group_name, notify_on_partner_request, etc.).
--
-- IMPORTANT: do not apply this migration until every existing
-- group_kind='one_on_one' group has at most one athlete — it will
-- reject the CREATE/ALTER itself... no, it won't reject creation (the
-- trigger only fires on future inserts/updates, not existing rows), but
-- it WILL then block any further legitimate write to an already-
-- violating group's membership (e.g. moving someone else in/out) until
-- that group is reconciled down to 1 athlete. Confirm the real
-- production violation (the "Ronnie Arnold" group) is resolved first.
create or replace function public.enforce_one_on_one_athlete_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_kind text;
  v_existing_count int;
begin
  if new.role <> 'athlete' then
    return new;
  end if;

  select group_kind into v_group_kind from public.groups where id = new.group_id;
  if v_group_kind <> 'one_on_one' then
    return new;
  end if;

  select count(*) into v_existing_count
  from public.group_memberships
  where group_id = new.group_id
    and role = 'athlete'
    and profile_id <> new.profile_id;

  if v_existing_count > 0 then
    raise exception 'This is a 1-on-1 group and already has a client — pick a different group, or create a new one.';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_one_on_one_athlete_limit
  before insert or update of group_id on public.group_memberships
  for each row execute function public.enforce_one_on_one_athlete_limit();
