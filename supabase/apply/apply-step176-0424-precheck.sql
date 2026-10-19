-- STEP 176 (PRECHECK, run first, changes nothing): 0424 FIX 2: the first person a program is assigned to gets the original, later people get a copy (replaces one function)
--
-- !! This REPLACES one function (assign_program_to_client). It is the 0337 text word for word with the attach rule widened to an active program in a group with no clients, and narrowed so a program someone already has a copy of, or a template with slots, is always copied. The paste checks the live function is exactly the text it replaces, and stops if not.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0424 is not already applied (the function does not yet check for copies)',
      not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') and position('c.source_program_id = src.id' in p.prosrc) > 0)),
    ('the function is exactly the text this replaces (0337)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'ea532ac6f03eb202b54e26147fec00df' from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')), false)),
    ('the slot column it reads exists',
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'is_slot') = 1),
    ('the copy column it reads exists',
      (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'source_program_id') = 1)
) as checks(check_name, ok);
