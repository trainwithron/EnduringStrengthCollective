-- UNDO for step 31 (delete-two-groups). A deleted group cannot be put back by a button. This lists what was saved in cleanup_backups so it can be restored by hand: every group, program, workout, exercise, set, note, progression and membership of both groups is in the payload.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
select id, taken_at, label, jsonb_object_keys(payload) as saved from public.cleanup_backups order by taken_at desc;
commit;
