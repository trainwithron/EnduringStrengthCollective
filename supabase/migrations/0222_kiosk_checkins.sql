-- Kiosk Check-In: a tablet-friendly attendance screen for large-roster
-- team/group settings. Investigated first (coach_mobile_more_tab_
-- condensed_widget_hub_sept30.md's follow-up queue) — confirmed no
-- existing table represents "did this athlete physically walk in
-- today": bookings is a scheduled slot (+ a manual no_show/late_cancel
-- flag set after the fact), athlete_sessions is a logged-workout state.
-- This is genuinely new.

-- Plain 4-digit PIN per membership, deliberately NOT hashed — the
-- coach must be able to view it (to tell/remind an athlete their own
-- code), which a one-way hash would prevent. This is attendance
-- tracking, not authentication-grade security, same "keep it minimal"
-- framing as every other low-stakes code in this app.
alter table public.group_memberships
  add column kiosk_pin text;

-- One row per physical check-in event. The kiosk tablet is opened
-- under the COACH's own authenticated session (same precedent as
-- app/groups/[groupId]/display/page.tsx's "Weight-Room Display Mode" —
-- no nav chrome, still a normal authenticated coach page) — athletes
-- never sign in on it themselves. Every write here is therefore the
-- coach's own authorization being exercised, not a new athlete-facing
-- auth surface.
create table public.kiosk_checkins (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index kiosk_checkins_group_id_idx on public.kiosk_checkins(group_id);
create index kiosk_checkins_athlete_id_idx on public.kiosk_checkins(athlete_id);

alter table public.kiosk_checkins enable row level security;
create policy "kiosk_checkins_coach_manage" on public.kiosk_checkins for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
