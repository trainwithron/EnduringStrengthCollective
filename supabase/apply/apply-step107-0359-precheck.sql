-- STEP 107 (PRECHECK, run first, changes nothing): 0359 Weights from a history import (the FitPros import) no longer set training maxes, so an old number from another app cannot steer what a client, above all a minor, is prescribed
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the training-max trigger function exists',
      to_regprocedure('public.recompute_training_max()') is not null),
    ('0359 is not already applied (the function does not leave out import stamps yet)',
      position('12:00:17' in pg_get_functiondef(to_regprocedure('public.recompute_training_max()'))) = 0)
) as checks(check_name, ok);
