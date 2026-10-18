-- UNDO for step 168 (0416). Only if a real person is wrongly blocked from posting. It drops the guard from posts and nothing else.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists minor_write_guard_insert on public.posts; drop policy if exists minor_write_guard_update on public.posts;
commit;
