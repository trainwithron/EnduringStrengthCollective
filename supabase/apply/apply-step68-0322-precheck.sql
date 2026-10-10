-- STEP 68 (PRECHECK, run first, changes nothing): 0322 Deleting a client no longer fails because of a record they once created (an invite, for example): one server-only function clears everything that still points at the person, from the database's own list, and refuses only for shared records (a group or organization they own, billing, team records)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0322 is not already applied (the clearing function does not exist yet)',
      to_regprocedure('public.detach_profile_references(uuid)') is null)
) as checks(check_name, ok);
