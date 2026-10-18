-- STEP 164 (PRECHECK, run first, changes nothing): 0412 Release T1: Download my data gives a person everything the app holds about them (two small functions and a private bucket)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0412 is not already applied (the functions are not there yet)',
      to_regprocedure('public.export_my_data_tables()') is null),
    ('the table it reads from exists',
      to_regclass('public.profiles') is not null),
    ('the storage bucket table exists',
      to_regclass('storage.buckets') is not null)
) as checks(check_name, ok);
