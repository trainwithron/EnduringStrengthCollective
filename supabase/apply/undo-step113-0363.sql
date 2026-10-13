-- UNDO for step 113 (0363). Only if step 113 misbehaves. Removes the smaller-goals table and every smaller goal saved so far.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.client_sub_goals;
commit;
