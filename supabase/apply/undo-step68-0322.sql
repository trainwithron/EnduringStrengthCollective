-- UNDO for step 68 (0322). Only if step 68 misbehaves. Removes the four functions; the app then fails to delete a client who has such records, as before.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.detach_profile_references(uuid);
drop function if exists public.profile_reference_unhandled();
drop function if exists public.profile_blocking_links();
drop function if exists public.profile_reference_policy();
commit;
