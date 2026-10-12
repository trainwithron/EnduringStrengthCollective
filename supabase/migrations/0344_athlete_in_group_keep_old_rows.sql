-- Release AV: follow-up to the athlete-in-group rule (0340). A row that already exists for this person in this group may still be written by its coach after the person has LEFT the group
-- (for example a refund or settlement that is an "insert ... on conflict do update" on session_credits: the database runs the insert-time check even when the insert turns into an update).
-- The rule still refuses a row about someone who has NEVER belonged to the group, which is the whole point: planting a first row needs a membership. Same function name; nothing else changes.

create or replace function public.enforce_athlete_in_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete uuid := nullif(to_jsonb(new)->>'athlete_id', '')::uuid;
  v_group uuid := nullif(to_jsonb(new)->>'group_id', '')::uuid;
  v_had_row boolean;
begin
  -- Only a signed-in person's own request is checked. The server (service role), definer jobs run by the database and migrations are not.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if v_athlete is null or v_group is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and v_athlete is not distinct from nullif(to_jsonb(old)->>'athlete_id', '')::uuid
     and v_group is not distinct from nullif(to_jsonb(old)->>'group_id', '')::uuid then
    return new;
  end if;
  if exists (select 1 from public.group_memberships gm where gm.group_id = v_group and gm.profile_id = v_athlete) then
    return new;
  end if;
  -- Not a member now: allowed only when this table already holds a row for this person in this group (they were here once; this is the coach tidying up after them).
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from %I.%I where athlete_id = $1 and group_id = $2)', tg_table_schema, tg_table_name)
      into v_had_row using v_athlete, v_group;
    if v_had_row then
      return new;
    end if;
  end if;
  raise exception 'That person is not a member of this group.' using errcode = '42501';
end;
$$;
revoke execute on function public.enforce_athlete_in_group() from public, anon, authenticated;
