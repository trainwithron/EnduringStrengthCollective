-- Release Z1: taking a client out of a group without destroying them, and a 30-day undo for a permanent delete.
--
-- Until now the only way a coach could get rid of a client was to erase the whole account. Now:
--   Remove from my clients   the person's membership in this group is taken away (they stop appearing in lists and counts, and lose the group), but their account, their data and everything filed under the group stay,
--                            linked to their email. A record of the membership is kept so the coach can put them back exactly as they were. There is no time limit.
--   Delete permanently       the same removal, plus a date 30 days away. Until that date the coach can undo it; on that date a scheduled job erases the account as the delete always did (unless they belong to other
--                            coaches' groups, in which case only the removal stands and the account is kept).
-- client_removals holds those records (name and email as they were, the membership as it was). A coach reads the records of their own groups; nothing is written to it from a browser. Additions only. Re-runnable.
create table if not exists public.client_removals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  athlete_name text,
  athlete_email text,
  membership jsonb not null,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_at timestamptz not null default now(),
  restored_at timestamptz,
  delete_after timestamptz,
  erase_history boolean not null default false,
  purged_at timestamptz,
  purge_note text
);
create unique index if not exists client_removals_one_open on public.client_removals (group_id, athlete_id) where restored_at is null and purged_at is null;
create index if not exists client_removals_due_idx on public.client_removals (delete_after) where restored_at is null and purged_at is null and delete_after is not null;
alter table public.client_removals enable row level security;
revoke all on public.client_removals from anon, authenticated;
grant select on public.client_removals to authenticated;
drop policy if exists "client_removals_select_coach" on public.client_removals;
create policy "client_removals_select_coach" on public.client_removals for select to authenticated using (public.is_group_coach(group_id));

-- Take a client out of the group. The caller must coach the group; the person must be a client of it; a coach cannot remove themselves or another coach.
create or replace function public.remove_client(p_group uuid, p_athlete uuid, p_permanent boolean default false, p_erase_history boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.group_memberships%rowtype;
  v_name text;
  v_email text;
  v_id uuid;
begin
  if me is null or not public.is_group_coach(p_group) then
    raise exception 'Only a coach of this group can remove a client.';
  end if;
  if p_athlete = me then
    raise exception 'You can''t remove yourself here.';
  end if;
  select * into m from public.group_memberships where group_id = p_group and profile_id = p_athlete and role = 'athlete' for update;
  if not found then
    raise exception 'That person isn''t a client in this group.';
  end if;
  select full_name into v_name from public.profiles where id = p_athlete;
  select lower(email) into v_email from auth.users where id = p_athlete;
  insert into public.client_removals (group_id, athlete_id, athlete_name, athlete_email, membership, removed_by, delete_after, erase_history)
  values (p_group, p_athlete, v_name, v_email, to_jsonb(m), me, case when p_permanent then now() + interval '30 days' else null end, p_permanent and p_erase_history)
  returning id into v_id;
  delete from public.group_memberships where id = m.id;
  perform public.audit_record('group_memberships', m.id::text, 'update', jsonb_build_object('event', case when p_permanent then 'client_deleted_30_day_undo' else 'client_removed' end, 'group', p_group, 'client', p_athlete, 'by', me, 'removal', v_id));
  return v_id;
end;
$$;
revoke execute on function public.remove_client(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.remove_client(uuid, uuid, boolean, boolean) to authenticated, service_role;

-- Put a removed client back exactly as they were (their position, tier, privacy setting and the rest), and cancel a scheduled delete. The caller must coach the group.
create or replace function public.restore_removed_client(p_removal uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.client_removals%rowtype;
begin
  select * into r from public.client_removals where id = p_removal for update;
  if not found or me is null or not public.is_group_coach(r.group_id) then
    raise exception 'That removal was not found.';
  end if;
  if r.restored_at is not null or r.purged_at is not null then
    raise exception 'That client has already been put back or deleted.';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = r.group_id and profile_id = r.athlete_id) then
    insert into public.group_memberships
    select * from jsonb_populate_record(null::public.group_memberships, r.membership || jsonb_build_object('id', gen_random_uuid()));
  end if;
  update public.client_removals set restored_at = now(), delete_after = null where id = r.id;
  perform public.audit_record('group_memberships', r.athlete_id::text, 'insert', jsonb_build_object('event', 'client_restored', 'group', r.group_id, 'client', r.athlete_id, 'by', me, 'removal', r.id));
  return r.athlete_id;
end;
$$;
revoke execute on function public.restore_removed_client(uuid) from public, anon;
grant execute on function public.restore_removed_client(uuid) to authenticated, service_role;
