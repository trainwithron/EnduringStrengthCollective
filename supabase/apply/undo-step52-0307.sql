-- UNDO for step 52 (0307). Only to diagnose. Puts back the default (anyone could run it, which does nothing useful since it only works as a trigger).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
grant execute on function public.notify_on_target_change() to public;
commit;
