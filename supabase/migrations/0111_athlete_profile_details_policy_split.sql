-- Last remaining multiple_permissive_policies finding (missed in 0110
-- since athlete_profile_details was added by 0108, after that pass's
-- data-gathering query). SELECT already self-covers the athlete's own
-- row, so just split the ALL policy into insert/update/delete, same
-- predicate, byte-identical write behavior.

drop policy "athlete_profile_details_write_own" on public.athlete_profile_details;

create policy "athlete_profile_details_insert_own" on public.athlete_profile_details for insert
  to authenticated with check (athlete_id = (select auth.uid()));

create policy "athlete_profile_details_update_own" on public.athlete_profile_details for update
  to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));

create policy "athlete_profile_details_delete_own" on public.athlete_profile_details for delete
  to authenticated using (athlete_id = (select auth.uid()));
