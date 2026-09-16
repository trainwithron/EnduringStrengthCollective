-- Real gap found while shipping 0182: an athlete who has never even
-- started intake (no client_intake row at all) has date_of_birth = null,
-- and 0182's training_partner_is_minor() deliberately treats a null DOB
-- as "not a minor" (an honest-uncertainty default for the many existing
-- adult users who predate that column). That's the right call for
-- existing users, but it leaves a real loophole: a brand-new athlete who
-- hasn't gotten past onboarding yet is fully visible/matchable in the
-- cross-org pool indefinitely, with nothing yet confirming they aren't a
-- minor. Ron's own words: "shouldnt be public until after they input
-- birthday in onboarding so people dont just pick the wrong date."
--
-- Reuses components/intake/intake-form.tsx's own completion signal —
-- computeInitialStep() returns "dob" whenever date_of_birth is null,
-- meaning intake hasn't even reached its first step — as the same
-- gate here, layered onto training_partner_is_restricted() exactly like
-- 0182 layered the minor-age check onto 0181's org check. Purely
-- additive to that one function; both policies already call it, so no
-- policy needs to be redefined again.
--
-- Deliberately scoped identically to 0181/0182: this only bites in the
-- cross-org branch of the visibility/insert policies (two athletes who
-- share an org can still match regardless of intake status, unchanged).
create or replace function public.training_partner_intake_incomplete(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.client_intake
    where athlete_id = p_athlete_id and date_of_birth is not null
  );
$$;

create or replace function public.training_partner_is_restricted(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.training_partner_org_restricted(p_athlete_id)
      or public.training_partner_is_minor(p_athlete_id)
      or public.training_partner_intake_incomplete(p_athlete_id);
$$;
