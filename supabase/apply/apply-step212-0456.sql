-- PASTE: step 212 (undoing a pasted list of one-on-one clients also removes the empty spaces it made, never one that holds anything else). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- Taking back a one-on-one client's space when an import is undone (Ron, Nov 20: onboarding O1; Commander review of 55cea37d). A pasted list makes each person a one-on-one client with a space of
-- their own; Undo removes the people, and their spaces should go too, but ONLY when nothing else was filed in them: deleting a group removes every row that points at it (about a hundred kinds of
-- record), and a coach may have booked a session, added a note or set macros there the same day.
-- discard_imported_one_on_one_space(group, coach) deletes the space only when all of these hold: it is a one-on-one space, made by this coach, in the last 24 hours; nobody but the coach is in it; and
-- no table that points at groups holds a row for it (read from the database's own list of foreign keys, so a table added later is checked too), apart from the coach's seat and the client's intake.
-- A delete stopped by any rule returns false and deletes nothing. Only the server calls it (the undo route, after its own checks). Re-running is safe.

create or replace function public.discard_imported_one_on_one_space(p_group uuid, p_coach uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  r record;
  v_found boolean;
begin
  -- The space is locked first: a row that points at it and is written while this checks waits for this to finish (and then fails, the space being gone) or is seen by the check below.
  select id, created_by, created_at, group_kind into g from public.groups where id = p_group for update;
  if not found or g.group_kind is distinct from 'one_on_one' or g.created_by is distinct from p_coach or g.created_at < now() - interval '24 hours' then
    return false;
  end if;
  if exists (select 1 from public.group_memberships where group_id = p_group and profile_id is distinct from p_coach) then
    return false;
  end if;
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.groups'::regclass
      and array_length(c.conkey, 1) = 1
      and c.conrelid not in ('public.group_memberships'::regclass, 'public.client_intake'::regclass)
  loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into v_found using p_group;
    if v_found then
      return false;
    end if;
  end loop;
  delete from public.groups where id = p_group;
  return found;
exception when others then
  return false;
end;
$$;
revoke all on function public.discard_imported_one_on_one_space(uuid, uuid) from public, anon, authenticated;
grant execute on function public.discard_imported_one_on_one_space(uuid, uuid) to service_role;

commit;

-- Check: one row, all true.
select
  to_regprocedure('public.discard_imported_one_on_one_space(uuid, uuid)') is not null as function_exists,
  (select prosecdef from pg_proc where oid = 'public.discard_imported_one_on_one_space(uuid, uuid)'::regprocedure) as runs_as_owner,
  not has_function_privilege('authenticated', 'public.discard_imported_one_on_one_space(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.discard_imported_one_on_one_space(uuid, uuid)', 'execute') as only_the_server_calls_it,
  public.discard_imported_one_on_one_space(gen_random_uuid(), gen_random_uuid()) = false as unknown_space_is_never_deleted;
