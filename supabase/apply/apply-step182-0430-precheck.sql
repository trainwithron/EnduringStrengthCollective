-- STEP 182 (PRECHECK, run first, changes nothing): 0430 Allergy auto-rebuild: when a client adds an allergy or a food they avoid, the options of their plan that now break it are swapped automatically, with a copy kept and the coach told (one column, one function added, one replaced)
--
-- !! This adds a source column to meal_plan_tries ('client' for every existing row and every try; 'allergy' for a system rebuild, which is try 0 and never counts as one of the client's 3 tries) and widens the try-number check to allow that. It adds apply_allergy_rebuild (server only): under the same per-client lock as a try, it keeps a copy of the days it changes, replaces ONLY their meals (days that already exist, today on, in that group; never their rationale, macros or author) and notifies the client's coaches. It REPLACES restore_meal_plan_try with the live text plus one check: an allergy rebuild cannot be put back. The paste checks that the live restore function is exactly the text this replaces, and stops if not.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0430 is not already applied (apply_allergy_rebuild is not there yet)',
      to_regprocedure('public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)') is null),
    ('restore_meal_plan_try is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '8046c690a08a1943b1b7fec489243744' from pg_proc p where p.oid = to_regprocedure('public.restore_meal_plan_try(uuid)')), false)),
    ('the table and functions it uses exist',
      to_regclass('public.meal_plan_tries') is not null and to_regclass('public.meal_plans') is not null and to_regprocedure('public.meal_plan_try_number(text)') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null),
    ('the meal_plan_try notice type is allowed',
      exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass and position('''meal_plan_try''' in pg_get_constraintdef(oid)) > 0))
) as checks(check_name, ok);
