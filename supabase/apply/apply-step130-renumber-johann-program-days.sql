-- STEP 130: give each day of the program 'Dont mess with the Johann' its own day number (its Day 1 and Day 2 both carry the number 1), keeping the order you see today; undoable
--
-- !! A one-time data change to ONE program (a7b5f600-3b62-4ec0-a016-d518f3f39a3e): it only changes the day numbers of its four days, in the order they show today (Day 1, Day 2, Day 3, Day 4 become numbers 1, 2, 3, 4). Nothing is deleted. It stops with nothing changed if the program does not look exactly like that.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: That program's four days keep their names and exercises and now each has its own day number. Step 131 (a day number is unique inside a week) needs this done first.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and day_index = 1 group by week_number having count(*) = 2))) then
    raise exception 'Step 130 (renumber-johann-program-days) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- renumber-johann-program-days: one-time data change
-- ====================================================================================================

update public.workouts w set day_index = r.rn
from (select id, row_number() over (partition by week_number order by day_index, created_at) as rn from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e') r
where w.id = r.id and w.program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and w.day_index <> r.rn;

commit;
