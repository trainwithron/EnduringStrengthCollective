-- Richer client profile fields — contact info, birthday, and a bit of
-- self-expression ("About me") on top of the existing bare full_name/
-- avatar_url. Deliberately a SEPARATE table from `profiles`, not new
-- columns on it: `profiles` has an unconditional `using (true)` SELECT
-- policy (any authenticated user can read any profile, matching how
-- full_name is already used in cross-org PR-share contexts) — phone
-- numbers and emergency contacts have no business being that widely
-- visible. This table is scoped to the athlete themselves and whichever
-- coach(es) actually coach them, mirroring the existing athlete_notes /
-- session_credits coach-visibility pattern.
create table public.athlete_profile_details (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  bio text,
  birthday date,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  updated_at timestamptz not null default now()
);

-- Mirrors is_client_of_coach (0023_booking.sql) in the opposite
-- direction: is the caller a coach of this specific athlete, in any
-- group they share — coach-wide, not group-scoped, same convention.
create or replace function public.is_coach_of_athlete(target_athlete_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.group_memberships gm_coach
    join public.group_memberships gm_athlete on gm_athlete.group_id = gm_coach.group_id
    where gm_coach.profile_id = (select auth.uid()) and gm_coach.role = 'coach'
      and gm_athlete.profile_id = target_athlete_id and gm_athlete.role = 'athlete'
  );
$$;

alter table public.athlete_profile_details enable row level security;

create policy "athlete_profile_details_select_own_or_coach" on public.athlete_profile_details for select
  to authenticated
  using (athlete_id = (select auth.uid()) or is_coach_of_athlete(athlete_id));

create policy "athlete_profile_details_write_own" on public.athlete_profile_details for all
  to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));
