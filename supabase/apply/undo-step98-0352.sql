-- UNDO for step 98 (0352). Only if step 98 misbehaves. Puts back the owner's right to insert memberships and removes the invitations and the leave function (pending invitations are lost).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.profile_id_for_email(text);
drop function if exists public.leave_organization(uuid);
drop function if exists public.answer_organization_invite(uuid, boolean);
drop table if exists public.organization_invites;
create policy "org_memberships_insert_owner" on public.organization_memberships for insert to authenticated with check ((EXISTS ( SELECT 1 FROM organizations o WHERE ((o.id = organization_memberships.organization_id) AND (o.owner_id = ( SELECT auth.uid() AS uid))))));
commit;
