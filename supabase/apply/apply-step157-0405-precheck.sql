-- STEP 157 (PRECHECK, run first, changes nothing): 0405 Release W2b: the bell notices that name a person ('X commented on your post', 'X mentioned you') show a member under 18, or of unknown age, as a first name and last initial
--
-- !! This REPLACES three existing notice functions (notify_on_comment, notify_on_mention, notify_on_post_mention). It is not an additions-only step. They behave as before except for the name in the notice.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0405 is not already applied (the notice-name function is not there yet)',
      to_regprocedure('public.notice_display_name(uuid)') is null),
    ('the notice functions it replaces exist',
      to_regprocedure('public.notify_on_comment()') is not null and to_regprocedure('public.notify_on_mention()') is not null and to_regprocedure('public.notify_on_post_mention()') is not null),
    ('the tables it reads exist',
      to_regclass('public.profiles') is not null and to_regclass('public.client_intake') is not null and to_regclass('public.organization_memberships') is not null)
) as checks(check_name, ok);
