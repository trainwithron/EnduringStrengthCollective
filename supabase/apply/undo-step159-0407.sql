-- UNDO for step 159 (0407). Only if step 159 misbehaves. Run it only while the Release Z1 code is not live, and only if no client has been removed yet: dropping the table forgets how removed clients were (their memberships are not restored).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists group_memberships_unarchive_one_on_one on public.group_memberships;
drop function if exists public.unarchive_one_on_one_on_client_join();
drop function if exists public.restore_removed_client(uuid);
drop function if exists public.remove_client(uuid, uuid, boolean, boolean);
drop table if exists public.client_removal_log;
drop table if exists public.client_removals;
commit;
