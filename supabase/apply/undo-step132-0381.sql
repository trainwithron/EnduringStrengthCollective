-- UNDO for step 132 (0381). Only if step 132 misbehaves. Removes the trigger and its function; names already changed stay.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists profiles_sync_one_on_one_group_name on public.profiles;
drop function if exists public.sync_one_on_one_group_name();
commit;
