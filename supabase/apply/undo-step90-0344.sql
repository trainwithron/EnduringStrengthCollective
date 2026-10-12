-- UNDO for step 90 (0344). Only if step 90 misbehaves. Puts back the first version of the rule (no exception for existing rows).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create or replace function public.enforce_athlete_in_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete uuid := nullif(to_jsonb(new)->>'athlete_id', '')::uuid;
  v_group uuid := nullif(to_jsonb(new)->>'group_id', '')::uuid;
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
  if not exists (select 1 from public.group_memberships gm where gm.group_id = v_group and gm.profile_id = v_athlete) then
    raise exception 'That person is not a member of this group.' using errcode = '42501';
  end if;
  return new;
end;
$$;
commit;
