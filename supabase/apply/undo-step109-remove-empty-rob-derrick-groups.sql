-- UNDO for step 109 (remove-empty-rob-derrick-groups). Only if the cleanup was wrong. Puts the two empty groups back exactly as they were (from the log) and drops the log.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
insert into public.groups select * from jsonb_populate_recordset(null::public.groups, (select coalesce(jsonb_agg(row), '[]'::jsonb) from public.orphan_group_cleanup_log));
drop table public.orphan_group_cleanup_log;
commit;
