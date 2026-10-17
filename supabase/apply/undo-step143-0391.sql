-- UNDO for step 143 (0391). Only if step 143 misbehaves. Run it only while the Release H code is not live (the Team page and the Leave button call these). Removes the new functions; run the 0352 step again to bring the old Leave back. Organizations and groups already moved stay where they are.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.close_organization(uuid);
drop function if exists public.extend_org_invite(uuid);
drop function if exists public.cancel_org_invite(uuid);
drop function if exists public.set_org_member_role(uuid, uuid, text);
drop function if exists public.remove_org_member(uuid, uuid, uuid);
drop function if exists public.leave_organization(uuid, uuid);
drop function if exists public._detach_coach_from_org(uuid, uuid, uuid, boolean);
drop function if exists public._solo_org_for(uuid, uuid);
-- then put the old one-argument leave_organization back by running step 0352 again (apply-step*-0352.sql)
commit;
