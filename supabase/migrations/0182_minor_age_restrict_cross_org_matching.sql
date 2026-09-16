-- Ron sharpened the safeguarding decision from 0181's org-level flag to
-- "no one under 18" — the org flag only protects orgs Ron personally
-- flags; it can't protect a future org with minors he doesn't know
-- about. Layers a per-athlete age check on top of the existing org
-- flag, both feeding the same combined "restricted" condition, both
-- still scoped to CROSS-org pairing only (same-org/within-team matching
-- stays completely unaffected, per 0181's own design — this is an
-- additive layer, not a redesign of that carve-out).
--
-- Reuses the same real infrastructure as the COPPA/waiver intake flow
-- (client_intake.date_of_birth, self-reported, migration 0121) rather
-- than building a second age-collection mechanism.
--
-- Null/missing date_of_birth is deliberately NOT treated as under 18 —
-- most real adult users today never filled this field in (it predates
-- this feature and is nullable), and blocking them by default would cut
-- off a feature they're using fine right now over an UNKNOWN signal,
-- not a confirmed one. A missing DOB is "we don't know," not "assume
-- adult" or "assume minor" — the safe default here is "don't newly
-- restrict," while the org-level flag above remains the real backstop
-- for a youth-heavy org where DOBs may not all be filled in yet.
create or replace function public.training_partner_is_minor(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select date_of_birth > (current_date - interval '18 years')::date
     from public.client_intake
     where athlete_id = p_athlete_id),
    false
  );
$$;

-- Combined disqualifying condition — either layer alone is enough to
-- restrict an athlete from the cross-org pool.
create or replace function public.training_partner_is_restricted(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.training_partner_org_restricted(p_athlete_id)
      or public.training_partner_is_minor(p_athlete_id);
$$;

drop policy "training_partner_profiles_select_visible" on public.training_partner_profiles;
create policy "training_partner_profiles_select_visible" on public.training_partner_profiles for select
  to authenticated using (
    visible = true
    and not public.training_partners_mutually_blocked(athlete_id, (select auth.uid()))
    and (
      public.training_partners_share_org(athlete_id, (select auth.uid()))
      or (
        not public.training_partner_is_restricted(athlete_id)
        and not public.training_partner_is_restricted((select auth.uid()))
      )
    )
  );

drop policy "training_partner_requests_insert_own" on public.training_partner_requests;
create policy "training_partner_requests_insert_own" on public.training_partner_requests for insert
  to authenticated with check (
    from_athlete_id = (select auth.uid())
    and not public.training_partners_mutually_blocked(to_athlete_id, (select auth.uid()))
    and (
      public.training_partners_share_org(to_athlete_id, (select auth.uid()))
      or (
        not public.training_partner_is_restricted(to_athlete_id)
        and not public.training_partner_is_restricted((select auth.uid()))
      )
    )
  );
