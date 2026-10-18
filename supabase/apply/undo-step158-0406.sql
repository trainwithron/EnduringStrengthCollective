-- UNDO for step 158 (0406). Only if step 158 misbehaves. Takes the restriction off again; athletes can then read teammates' membership rows as before.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "group_memberships_select_narrow" on public.group_memberships;
drop function if exists public.group_member_count(uuid);
commit;
