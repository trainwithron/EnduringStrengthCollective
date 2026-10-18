-- UNDO for step 167 (0415). Only while no guard (step 168 or 169) is applied; undo those first, or the drop is refused.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.minor_may_write(uuid); drop function if exists public.age_threshold_date(date, integer);
commit;
