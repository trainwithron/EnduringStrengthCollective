-- STEP 125 (PRECHECK, run first, changes nothing): 0375 InBody scans from a photo of the result sheet: the scans, a private place for the photos, and the one function that saves a scan
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0375 is not already applied (no scans table yet)',
      to_regclass('public.body_scans') is null),
    ('body weight logs and the athlete-in-group rule exist',
      to_regclass('public.body_weight_logs') is not null and to_regprocedure('public.enforce_athlete_in_group()') is not null),
    ('the org wall check exists',
      to_regprocedure('public.group_in_active_org(uuid)') is not null)
) as checks(check_name, ok);
