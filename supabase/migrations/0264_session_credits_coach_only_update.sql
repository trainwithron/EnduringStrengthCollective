-- A client could rewrite their own session balance (and, since 0260, their own payment hold) straight through the API.
--
-- 0085 removed the athlete's update policy on session_credits for exactly this reason. 0110's policy consolidation merged the
-- athlete and coach update policies into one ("credits_update_own_or_coach", athlete_id = the caller OR a coach of the group),
-- which put the athlete branch back. Found by the migration rehearsal: a signed-in client could run
--   update session_credits set balance = 99 where athlete_id = <themselves>
-- and bypass the ledger entirely. Every legitimate change goes through the credit functions (security definer) or the server
-- (service role), so only a coach of the group needs a direct update path, and that is all this leaves.
--
-- Additive and safe to apply at any time: nothing a client legitimately does updates this table directly.
drop policy if exists "credits_update_own_or_coach" on public.session_credits;
drop policy if exists "credits_update_coach" on public.session_credits;
create policy "credits_update_coach" on public.session_credits for update
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
