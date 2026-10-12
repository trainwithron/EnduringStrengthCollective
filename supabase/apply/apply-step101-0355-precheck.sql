-- STEP 101 (PRECHECK, run first, changes nothing): 0355 A coach can attach their own assessments (notes, numbers and a PDF, photo or video) to a client's profile; only the coaches of that client's group can see them
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0355 is not already applied (the assessments table does not exist yet)',
      to_regclass('public.client_assessments') is null),
    ('the storage and group tables the rules read exist',
      to_regclass('storage.objects') is not null and to_regclass('public.group_memberships') is not null)
) as checks(check_name, ok);
