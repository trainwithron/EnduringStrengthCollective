-- STEP 132: 0381 A one-on-one space's name follows its client's name when the client's name is corrected
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes now. From now on, when a client's name is changed, their one-on-one space is renamed with it, but only if the space still carried the old name exactly. The three spaces whose names already differ from their client (Jeff Z, Johann Gorsik, Ronnie Arnold) are not touched.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.sync_one_on_one_group_name()') is null)) then
    raise exception 'Step 132 (0381) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0381_one_on_one_group_name_follows_client.sql
-- ====================================================================================================

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

commit;
