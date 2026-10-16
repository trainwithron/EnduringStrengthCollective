-- Release CI: a one-on-one space is named after its client. When the client's name changes (they fix a typo, add a middle initial), the space's name follows, but only when the space still carried the
-- OLD name exactly (a name the coach chose on purpose, such as "Jeff Z", is never overwritten). Existing spaces whose names already differ are left alone. Re-runnable.
create or replace function public.sync_one_on_one_group_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name and coalesce(btrim(new.full_name), '') <> '' and coalesce(btrim(old.full_name), '') <> '' then
    update public.groups g
       set name = btrim(new.full_name)
     where g.group_kind = 'one_on_one'
       and lower(btrim(g.name)) = lower(btrim(old.full_name))
       and exists (select 1 from public.group_memberships m where m.group_id = g.id and m.profile_id = new.id and m.role = 'athlete');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_one_on_one_group_name() from public, anon, authenticated;

drop trigger if exists profiles_sync_one_on_one_group_name on public.profiles;
create trigger profiles_sync_one_on_one_group_name after update of full_name on public.profiles
  for each row execute function public.sync_one_on_one_group_name();
