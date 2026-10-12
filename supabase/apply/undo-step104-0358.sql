-- UNDO for step 104 (0358). Only if step 104 misbehaves. Puts the organization wall back as it was and removes the personal-space function. Personal spaces already created stay (and the column stays optional while any exist), so nothing anyone saved is lost.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists group_memberships_guard_personal_space on public.group_memberships;
drop function if exists public.guard_personal_space_members();
drop trigger if exists notifications_skip_personal_space on public.notifications;
drop function if exists public.skip_personal_space_notifications();
drop function if exists public.ensure_personal_space();
drop index if exists public.groups_one_personal_space_per_person;
create or replace function public.group_in_active_org(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.request_workspace_org() is null
      or _group_id is null
      or exists (select 1 from public.groups g where g.id = _group_id and g.organization_id = public.request_workspace_org())
$$;
create or replace function public.guard_one_on_one_program()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_one_on_one_group(new.group_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id and new.athlete_id is not distinct from old.athlete_id then
    return new;
  end if;
  if new.athlete_id is null then
    new.athlete_id := public.one_on_one_athlete(new.group_id);
    if new.athlete_id is null then
      raise exception 'A program in a client''s own space has to be made for that client.' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.athlete_id and gm.role = 'athlete') then
    raise exception 'A program in a client''s own space has to be made for that client.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_one_on_one_program() from public, anon, authenticated;
do $u$ begin if not exists (select 1 from public.groups where organization_id is null) then alter table public.groups alter column organization_id set not null; end if; end $u$;
commit;
