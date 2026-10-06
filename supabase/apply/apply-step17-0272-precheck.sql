-- STEP 17 (PRECHECK, run first, changes nothing): 0272 the discovery-call and gym QR functions are server-only (ONLY after the release with the two new server routes is deployed)
--
-- !! Do NOT run this until the release that contains /api/public/discovery-book and /api/public/gym-lead is deployed AND step 13 (0271) is applied. If you run it first, the public discovery-call page and the gym QR form show an error until the deploy.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0271 is applied (the signed-out role cannot run book_session)',
      not has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')),
    ('the two functions exist',
      exists (select 1 from pg_proc where proname = 'book_discovery_call' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'submit_gym_visitor_lead' and pronamespace = 'public'::regnamespace)),
    ('0272 is not already applied (the signed-out role can still run book_discovery_call)',
      has_function_privilege('anon', 'public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text)', 'execute'))
) as checks(check_name, ok);
