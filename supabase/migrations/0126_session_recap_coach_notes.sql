-- Coach-only notes for the new "Recap & Up Next" screen: one evolving
-- note about a whole completed session, and one about a specific
-- exercise within a session (reused for both the real note logged
-- against today's completed exercise, and the "carried forward"
-- suggestion shown against that same exercise on the athlete's next
-- scheduled workout — both read/write this same table, just different
-- session_exercise_id rows).
--
-- Deliberately NOT a bare column on session_exercises, even though the
-- per-exercise note attaches to the same row session_exercise_videos
-- already does. session_exercises' own SELECT policy already lets the
-- owning athlete read their own rows — a plain column there could only
-- ever be a hidden-UI convention, never a real "the athlete can't see
-- this" boundary, since Postgres RLS is row-level, not column-level.
-- Both new note types get their own table instead, matching the
-- coach-only shape athlete_notes (0016) already established, so "never
-- athlete-visible" is a real, independently-testable RLS policy.

create table public.session_coach_notes (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.athlete_sessions(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  unique (session_id)
);
create index session_coach_notes_session_idx on public.session_coach_notes(session_id);

alter table public.session_coach_notes enable row level security;
create policy "session_coach_notes_coach_only" on public.session_coach_notes for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

create table public.session_exercise_coach_notes (
  id uuid primary key default uuid_generate_v4(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  unique (session_exercise_id)
);
create index session_exercise_coach_notes_exercise_idx on public.session_exercise_coach_notes(session_exercise_id);

alter table public.session_exercise_coach_notes enable row level security;
create policy "session_exercise_coach_notes_coach_only" on public.session_exercise_coach_notes for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
