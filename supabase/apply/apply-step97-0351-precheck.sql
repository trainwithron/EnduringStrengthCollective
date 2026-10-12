-- STEP 97 (PRECHECK, run first, changes nothing): 0351 Duplicate makes an unassigned library program: a copy that is not for a client comes out not active, so no team or client sees it until the coach assigns it or sets it active
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0351 is not already applied (Duplicate still comes out active)',
      position('p_athlete_id is null then false' in pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'))) = 0),
    ('Duplicate exists',
      to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null)
) as checks(check_name, ok);
