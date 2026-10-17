-- UNDO for step 138 (flag-clients-without-intake). Puts back exactly the clients this step flagged (listed in intake_flag_log); nobody else is touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
update public.profiles set intake_required = false where id in (select profile_id from public.intake_flag_log);
drop table if exists public.intake_flag_log;
commit;
