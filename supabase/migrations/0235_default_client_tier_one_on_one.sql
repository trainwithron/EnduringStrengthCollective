-- The coach push on a client's workout (and other one-on-one-only features)
-- keys on group_memberships.client_tier = 'one_on_one', but nothing ever set
-- it when a client joined or was created: 12 of 18 athletes had NULL, 5 of
-- those in one-on-one groups. Set it automatically for anyone who joins a
-- one-on-one group, and backfill the existing ones. Team/social members are
-- untouched (their tier, if any, is still the coach's choice).

create or replace function public.default_client_tier_for_one_on_one()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'athlete' and new.client_tier is null then
    if exists (select 1 from public.groups g where g.id = new.group_id and g.group_kind = 'one_on_one') then
      new.client_tier := 'one_on_one';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_default_client_tier_one_on_one
  before insert on public.group_memberships
  for each row execute function public.default_client_tier_for_one_on_one();

update public.group_memberships m
   set client_tier = 'one_on_one'
  from public.groups g
 where g.id = m.group_id
   and g.group_kind = 'one_on_one'
   and m.role = 'athlete'
   and m.client_tier is null;
