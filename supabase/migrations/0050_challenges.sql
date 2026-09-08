-- Phase 3 of the ESN roadmap: Social Media Challenges, v1. Scoped down
-- from the full long-term vision (see long_term_feature_backlog memory)
-- to what's buildable without real billing: a coach runs a time-boxed
-- challenge for their EXISTING clients (not yet open to true outside
-- social-media signups, which needs a public signup flow that doesn't
-- exist in this app at all yet). Entry fee is tracked as a number, not
-- collected — same "everything except Stripe" pattern as the Business
-- dashboard's client rates.

create type public.challenge_status as enum ('draft', 'active', 'completed');

create table public.challenges (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  start_date date not null,
  duration_weeks int not null check (duration_weeks > 0),
  entry_fee_cents int not null default 0 check (entry_fee_cents >= 0),
  status public.challenge_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table public.challenge_habits (
  id uuid primary key default uuid_generate_v4(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  title text not null,
  sort_order int not null default 0
);

create table public.challenge_participants (
  id uuid primary key default uuid_generate_v4(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  before_photo_url text,
  after_photo_url text,
  unique (challenge_id, profile_id)
);

create table public.challenge_habit_logs (
  id uuid primary key default uuid_generate_v4(),
  challenge_habit_id uuid not null references public.challenge_habits(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  completed_at timestamptz,
  unique (challenge_habit_id, profile_id, log_date)
);

alter table public.challenges enable row level security;
alter table public.challenge_habits enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.challenge_habit_logs enable row level security;

-- challenges: the coach fully manages their own; clients of that coach
-- can browse anything past "draft" (a draft is still being set up).
create policy "challenges_coach_manage" on public.challenges for all
  to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

create policy "challenges_client_select" on public.challenges for select
  to authenticated
  using (status <> 'draft' and public.is_client_of_coach(coach_id));

-- challenge_habits: visible to anyone who can see the parent challenge;
-- only the owning coach can write.
create policy "challenge_habits_coach_manage" on public.challenge_habits for all
  to authenticated
  using (exists (
    select 1 from public.challenges c where c.id = challenge_id and c.coach_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.challenges c where c.id = challenge_id and c.coach_id = auth.uid()
  ));

create policy "challenge_habits_select" on public.challenge_habits for select
  to authenticated
  using (exists (
    select 1 from public.challenges c
    where c.id = challenge_id
      and (c.coach_id = auth.uid() or (c.status <> 'draft' and public.is_client_of_coach(c.coach_id)))
  ));

-- challenge_participants: a client can join an active challenge run by
-- their own coach (self-insert only); everyone who's already a
-- participant, or the coach, can see the roster (needed for the
-- leaderboard); a participant can update only their own row (photos).
create policy "challenge_participants_self_join" on public.challenge_participants for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.challenges c
      where c.id = challenge_id and c.status = 'active' and public.is_client_of_coach(c.coach_id)
    )
  );

create policy "challenge_participants_select" on public.challenge_participants for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (select 1 from public.challenges c where c.id = challenge_id and c.coach_id = auth.uid())
    or exists (
      select 1 from public.challenge_participants cp2
      where cp2.challenge_id = challenge_participants.challenge_id and cp2.profile_id = auth.uid()
    )
  );

create policy "challenge_participants_update_own" on public.challenge_participants for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "challenge_participants_coach_manage" on public.challenge_participants for all
  to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.coach_id = auth.uid()))
  with check (exists (select 1 from public.challenges c where c.id = challenge_id and c.coach_id = auth.uid()));

-- challenge_habit_logs: a participant writes only their own check-offs;
-- reads are broader (own rows, the coach, or a fellow participant of the
-- same challenge) because a leaderboard needs to compare completion
-- counts across participants — these are just daily checkmarks, not
-- sensitive detail.
create policy "challenge_habit_logs_write_own" on public.challenge_habit_logs for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "challenge_habit_logs_select" on public.challenge_habit_logs for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.challenge_habits ch
      join public.challenges c on c.id = ch.challenge_id
      where ch.id = challenge_habit_id and c.coach_id = auth.uid()
    )
    or exists (
      select 1 from public.challenge_habits ch
      join public.challenge_participants cp on cp.challenge_id = ch.challenge_id
      where ch.id = challenge_habit_id and cp.profile_id = auth.uid()
    )
  );
