-- STEP 130 (PRECHECK, run first, changes nothing): give each day of the program 'Dont mess with the Johann' its own day number (its Day 1 and Day 2 both carry the number 1), keeping the order you see today; undoable
--
-- !! A one-time data change to ONE program (a7b5f600-3b62-4ec0-a016-d518f3f39a3e): it only changes the day numbers of its four days, in the order they show today (Day 1, Day 2, Day 3, Day 4 become numbers 1, 2, 3, 4). Nothing is deleted. It stops with nothing changed if the program does not look exactly like that.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the program has exactly the four days it had, and two of them share day number 1',
      (select count(*) from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e') = 4 and (select count(*) from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and week_number = 1 and day_index = 1) = 2),
    ('step 130 is not already applied (the days do not already have 1, 2, 3, 4)',
      exists (select 1 from public.workouts where program_id = 'a7b5f600-3b62-4ec0-a016-d518f3f39a3e' and day_index = 1 group by week_number having count(*) = 2))
) as checks(check_name, ok);
