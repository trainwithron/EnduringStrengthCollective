-- UNDO for step 84 (0338). Only if step 84 misbehaves. Puts back the old single parent-link rule (any coach of the group, no age check) and opens the three training-partner functions again as they were. The links lose their expiry date.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists "guardian_links_coach_select" on public.guardian_links;
drop policy if exists "guardian_links_coach_insert" on public.guardian_links;
drop policy if exists "guardian_links_coach_update" on public.guardian_links;
drop policy if exists "guardian_links_coach_delete" on public.guardian_links;
drop policy if exists "guardian_links_coach_manage" on public.guardian_links;
create policy "guardian_links_coach_manage" on public.guardian_links for all to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
grant update on public.guardian_links to authenticated;
drop function if exists public.guardian_link_allowed(uuid, uuid);
alter table public.guardian_links drop column if exists expires_at;
grant execute on function public.training_partner_is_minor(uuid) to public, anon, authenticated;
grant execute on function public.training_partner_intake_incomplete(uuid) to public, anon, authenticated;
grant execute on function public.training_partner_org_restricted(uuid) to public, anon, authenticated;
commit;
