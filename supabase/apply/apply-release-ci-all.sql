-- RELEASE CI (A DAY NUMBER IS UNIQUE INSIDE A WEEK OF A PROGRAM; A ONE-ON-ONE SPACE FOLLOWS ITS CLIENT NAME; RUN IN ORDER 130, 131, 132, BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 130, 131, 132 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 130: That program's four days keep their names and exercises and now each has its own day number. Step 131 (a day number is unique inside a week) needs this done first.
-- AFTER STEP 131: Nothing changes on screen. From now on two days of one program cannot get the same week and day number at the same moment; the app picks the next free number and tries again if it loses a race.
-- AFTER STEP 132: Nothing changes now. From now on, when a client's name is changed, their one-on-one space is renamed with it, but only if the space still carried the old name exactly. The three spaces whose names already differ from their client (Jeff Z, Johann Gorsik, Ronnie Arnold) are not touched.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CI (a day number is unique inside a week of a program; a one-on-one space follows its client name; run in order 130, 131, 132, BEFORE the code that goes with it is live), step 130: give each day of the program 'Dont mess with the Johann' its own day number (its Day 1 and Day 2 both carry the number 1), keeping the order you see today; undoable
do $g130$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('the program has exactly the four days it had, and two of them share day number 1', (select count(*) from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e') = 4 and (select count(*) from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and week_number = 1 and day_index = 1) = 2),
      ('step 130 is not already applied (the days do not already have 1, 2, 3, 4)', exists (select 1 from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and day_index = 1 group by week_number having count(*) = 2))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CI (a day number is unique inside a week of a program; a one-on-one space follows its client name; run in order 130, 131, 132, BEFORE the code that goes with it is live), step 130 (renumber-johann-program-days) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g130$;

update public.workouts w set day_index = r.rn
from (select id, row_number() over (partition by week_number order by day_index, created_at) as rn from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e') r
where w.id = r.id and w.program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and w.day_index <> r.rn;

-- ===== Release CI (a day number is unique inside a week of a program; a one-on-one space follows its client name; run in order 130, 131, 132, BEFORE the code that goes with it is live), step 131: 0380 A day number is unique inside a week of a program
do $g131$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0380 is not already applied (the rule is not there yet)', not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass)),
      ('no program has two days with the same week and day number (run step 130 first if this says false)', not exists (select 1 from public.workouts group by program_id, week_number, day_index having count(*) > 1))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CI (a day number is unique inside a week of a program; a one-on-one space follows its client name; run in order 130, 131, 132, BEFORE the code that goes with it is live), step 131 (0380) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g131$;

-- ====================================================================================================
-- migration 0380_program_day_numbers_unique.sql
-- ====================================================================================================

-- Release CI: a day number is unique inside a week of a program (two days can no longer both be "Week 1, Day 1" when two tabs or a double click add a day at the same moment).
-- The app now reads the next free number from what is saved and retries when it loses a race. Needs every program to have only one day per number already (step 130 fixes the one program that had two). Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass) then
    alter table public.workouts add constraint workouts_program_week_day_key unique (program_id, week_number, day_index);
  end if;
end $$;

-- ===== Release CI (a day number is unique inside a week of a program; a one-on-one space follows its client name; run in order 130, 131, 132, BEFORE the code that goes with it is live), step 132: 0381 A one-on-one space's name follows its client's name when the client's name is corrected
do $g132$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0381 is not already applied (the function is not there yet)', to_regprocedure('public.sync_one_on_one_group_name()') is null),
      ('the profiles and groups tables exist', to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CI (a day number is unique inside a week of a program; a one-on-one space follows its client name; run in order 130, 131, 132, BEFORE the code that goes with it is live), step 132 (0381) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g132$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 130 (renumber-johann-program-days)' as step, 'give each day of the program ''Dont mess with the Johann'' its own day number' as what, not ((exists (select 1 from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and day_index = 1 group by week_number having count(*) = 2))) as in_place
  union all
  select 'step 131 (0380)' as step, '0380 A day number is unique inside a week of a program' as what, not ((not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass))) as in_place
  union all
  select 'step 132 (0381)' as step, '0381 A one-on-one space''s name follows its client''s name when the client''s name is corrected' as what, not ((to_regprocedure('public.sync_one_on_one_group_name()') is null)) as in_place
) as result order by step;
