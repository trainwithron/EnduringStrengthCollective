-- UNDO for step 30 (copy-main-group-program). Only if the copy is wrong. Removes the copy in The Home Team (the original in Main Group is untouched).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
delete from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program';
commit;
