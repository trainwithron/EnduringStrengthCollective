-- ============================================================================
-- ENDURING STRENGTH CO. — HOME TEAM LIFTING CLUB
-- Supabase Postgres Schema v1
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
create type member_role as enum ('coach', 'athlete');
create type session_status as enum ('in_progress', 'completed', 'abandoned');
create type set_status as enum ('pending', 'completed', 'skipped');
create type reaction_type as enum ('fist_bump', 'fire', 'strong');
create type post_type as enum ('user_post', 'workout_summary');

-- ----------------------------------------------------------------------------
-- PROFILES (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- GROUPS
-- ----------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- GROUP MEMBERSHIPS (join table: profile <-> group, with role)
-- ----------------------------------------------------------------------------
create table public.group_memberships (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role member_role not null default 'athlete',
  joined_at timestamptz not null default now(),
  unique (group_id, profile_id)
);

create index idx_group_memberships_group on public.group_memberships(group_id);
create index idx_group_memberships_profile on public.group_memberships(profile_id);

-- ----------------------------------------------------------------------------
-- PROGRAMS (a named block, e.g. "Strength Block 3", scoped to a group)
-- ----------------------------------------------------------------------------
create table public.programs (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_programs_group on public.programs(group_id);

-- ----------------------------------------------------------------------------
-- WORKOUTS (a single day's template within a program, e.g. "Day 1 - Squat")
-- ----------------------------------------------------------------------------
create table public.workouts (
  id uuid primary key default uuid_generate_v4(),
  program_id uuid not null references public.programs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- denormalized for RLS simplicity
  title text not null,
  day_index int not null, -- ordering within the program
  scheduled_date date, -- optional: pin to a calendar date for the group
  notes text,
  created_at timestamptz not null default now()
);

create index idx_workouts_program on public.workouts(program_id);
create index idx_workouts_group on public.workouts(group_id);

-- ----------------------------------------------------------------------------
-- GROUP_WORKOUT_EXERCISES (the master template's prescribed exercises/sets)
-- This is the "group_workouts" template layer referenced in the logging UX spec.
-- ----------------------------------------------------------------------------
create table public.group_workout_exercises (
  id uuid primary key default uuid_generate_v4(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- denormalized for RLS
  exercise_name text not null,
  exercise_order int not null default 0,
  prescribed_sets int not null default 3,
  prescribed_reps text, -- text to allow "5", "8-10", "AMRAP"
  prescribed_load_note text, -- e.g. "RPE 8", "70% 1RM"
  created_at timestamptz not null default now()
);

create index idx_gwe_workout on public.group_workout_exercises(workout_id);
create index idx_gwe_group on public.group_workout_exercises(group_id);

-- ----------------------------------------------------------------------------
-- ATHLETE_SESSIONS (instantiated when an athlete taps "Start Workout")
-- This is the athlete's own mutable copy — additions/swaps never touch the template.
-- ----------------------------------------------------------------------------
create table public.athlete_sessions (
  id uuid primary key default uuid_generate_v4(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- denormalized for RLS
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  status session_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds int,
  unique (workout_id, athlete_id) -- one active/completed session per athlete per workout
);

create index idx_sessions_athlete on public.athlete_sessions(athlete_id);
create index idx_sessions_workout on public.athlete_sessions(workout_id);
create index idx_sessions_group on public.athlete_sessions(group_id);

-- ----------------------------------------------------------------------------
-- SESSION_EXERCISES (athlete's instance of each exercise — supports swap/add)
-- Nullable FK back to the template exercise: null = athlete-added, non-null = derived from template.
-- ----------------------------------------------------------------------------
create table public.session_exercises (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.athlete_sessions(id) on delete cascade,
  group_workout_exercise_id uuid references public.group_workout_exercises(id) on delete set null,
  exercise_name text not null, -- copied at instantiation; mutable if athlete swaps
  exercise_order int not null default 0,
  is_swapped boolean not null default false,
  is_added boolean not null default false, -- true if athlete added it (no template origin)
  created_at timestamptz not null default now()
);

create index idx_session_exercises_session on public.session_exercises(session_id);

-- ----------------------------------------------------------------------------
-- SET_LOGS (individual set execution data — the core logging unit)
-- ----------------------------------------------------------------------------
create table public.set_logs (
  id uuid primary key default uuid_generate_v4(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  set_order int not null default 0,
  weight numeric(6,2), -- supports decimal plates (e.g. 42.5 kg)
  reps int,
  rpe numeric(3,1), -- optional RPE, e.g. 8.5
  status set_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_set_logs_session_exercise on public.set_logs(session_exercise_id);

-- ----------------------------------------------------------------------------
-- WORKOUT_LOGS (rollup summary per athlete/workout — powers "Last time: X" lookups
-- and the feed's auto-generated summary card without re-aggregating set_logs every time)
-- ----------------------------------------------------------------------------
create table public.workout_logs (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.athlete_sessions(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  total_volume numeric(10,2), -- sum(weight * reps) across all completed sets
  total_sets_completed int,
  total_duration_seconds int,
  created_at timestamptz not null default now()
);

create index idx_workout_logs_athlete_workout on public.workout_logs(athlete_id, workout_id);
create index idx_workout_logs_group on public.workout_logs(group_id);

-- ----------------------------------------------------------------------------
-- POSTS (community feed — user posts + auto-generated workout summary cards)
-- ----------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  post_type post_type not null default 'user_post',
  body text,
  media_url text, -- Supabase Storage path (image/video)
  media_type text, -- 'image' | 'video', null if text-only
  workout_log_id uuid references public.workout_logs(id) on delete set null, -- set only for auto-generated summary cards
  created_at timestamptz not null default now()
);

create index idx_posts_group_created on public.posts(group_id, created_at desc);
create index idx_posts_author on public.posts(author_id);

-- ----------------------------------------------------------------------------
-- COMMENTS (threaded, scoped to a post)
-- ----------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- denormalized for RLS
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade, -- null = top-level
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_comments_post on public.comments(post_id);
create index idx_comments_parent on public.comments(parent_comment_id);

-- ----------------------------------------------------------------------------
-- REACTIONS (fist-bumps etc. — polymorphic-ish via post_id, one per user per post)
-- ----------------------------------------------------------------------------
create table public.reactions (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- denormalized for RLS
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type reaction_type not null default 'fist_bump',
  created_at timestamptz not null default now(),
  unique (post_id, profile_id, reaction_type)
);

create index idx_reactions_post on public.reactions(post_id);

-- ============================================================================
-- HELPER FUNCTIONS (used by RLS policies — SECURITY DEFINER to avoid recursive
-- RLS lookups on group_memberships itself)
-- ============================================================================

-- Is the current user a member (any role) of this group?
create or replace function public.is_group_member(_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships
    where group_id = _group_id
      and profile_id = auth.uid()
  );
$$;

-- Is the current user a coach in this group?
create or replace function public.is_group_coach(_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships
    where group_id = _group_id
      and profile_id = auth.uid()
      and role = 'coach'
  );
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.programs enable row level security;
alter table public.workouts enable row level security;
alter table public.group_workout_exercises enable row level security;
alter table public.athlete_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.set_logs enable row level security;
alter table public.workout_logs enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;

-- ----------------------------------------------------------------------------
-- PROFILES
-- Anyone authenticated can view profiles (needed for roster/feed display names).
-- Users can only edit their own profile.
-- ----------------------------------------------------------------------------
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- GROUPS
-- Members can view their own group(s). Only coaches can update group details.
-- Any authenticated user can create a group (becomes its first coach via app logic).
-- ----------------------------------------------------------------------------
create policy "groups_select_members"
  on public.groups for select
  to authenticated
  using (public.is_group_member(id));

create policy "groups_insert_authenticated"
  on public.groups for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "groups_update_coach"
  on public.groups for update
  to authenticated
  using (public.is_group_coach(id))
  with check (public.is_group_coach(id));

-- ----------------------------------------------------------------------------
-- GROUP_MEMBERSHIPS
-- Members can view the roster of their own group. Only coaches manage membership.
-- ----------------------------------------------------------------------------
create policy "memberships_select_same_group"
  on public.group_memberships for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "memberships_insert_coach_or_self"
  on public.group_memberships for insert
  to authenticated
  with check (
    public.is_group_coach(group_id)
    or profile_id = auth.uid() -- allows self-join flows (e.g. invite links) if desired
  );

create policy "memberships_update_coach"
  on public.group_memberships for update
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

create policy "memberships_delete_coach_or_self"
  on public.group_memberships for delete
  to authenticated
  using (public.is_group_coach(group_id) or profile_id = auth.uid());

-- ----------------------------------------------------------------------------
-- PROGRAMS / WORKOUTS / GROUP_WORKOUT_EXERCISES
-- All group members can read (athletes need to see what's prescribed).
-- Only coaches can write.
-- ----------------------------------------------------------------------------
create policy "programs_select_members"
  on public.programs for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "programs_write_coach"
  on public.programs for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

create policy "workouts_select_members"
  on public.workouts for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "workouts_write_coach"
  on public.workouts for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

create policy "gwe_select_members"
  on public.group_workout_exercises for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "gwe_write_coach"
  on public.group_workout_exercises for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

-- ----------------------------------------------------------------------------
-- ATHLETE_SESSIONS
-- Athletes: full CRUD on their own sessions only.
-- Coaches: read-only visibility across the whole group (accountability/oversight).
-- ----------------------------------------------------------------------------
create policy "sessions_select_own_or_coach"
  on public.athlete_sessions for select
  to authenticated
  using (
    athlete_id = auth.uid()
    or public.is_group_coach(group_id)
  );

create policy "sessions_insert_own"
  on public.athlete_sessions for insert
  to authenticated
  with check (
    athlete_id = auth.uid()
    and public.is_group_member(group_id)
  );

create policy "sessions_update_own"
  on public.athlete_sessions for update
  to authenticated
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

create policy "sessions_delete_own"
  on public.athlete_sessions for delete
  to authenticated
  using (athlete_id = auth.uid());

-- ----------------------------------------------------------------------------
-- SESSION_EXERCISES
-- Scoped via parent athlete_sessions row (no direct group_id column here).
-- ----------------------------------------------------------------------------
create policy "session_exercises_select_own_or_coach"
  on public.session_exercises for select
  to authenticated
  using (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and (s.athlete_id = auth.uid() or public.is_group_coach(s.group_id))
    )
  );

create policy "session_exercises_write_own"
  on public.session_exercises for all
  to authenticated
  using (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and s.athlete_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and s.athlete_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- SET_LOGS
-- Scoped via session_exercises -> athlete_sessions chain.
-- ----------------------------------------------------------------------------
create policy "set_logs_select_own_or_coach"
  on public.set_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and (s.athlete_id = auth.uid() or public.is_group_coach(s.group_id))
    )
  );

create policy "set_logs_write_own"
  on public.set_logs for all
  to authenticated
  using (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and s.athlete_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and s.athlete_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- WORKOUT_LOGS
-- Athlete owns their rollup; coach can view all in their group; both needed
-- for "Last time: X" lookups (own) and coach dashboards.
-- ----------------------------------------------------------------------------
create policy "workout_logs_select_own_or_coach"
  on public.workout_logs for select
  to authenticated
  using (
    athlete_id = auth.uid()
    or public.is_group_coach(group_id)
  );

create policy "workout_logs_insert_own"
  on public.workout_logs for insert
  to authenticated
  with check (
    athlete_id = auth.uid()
    and public.is_group_member(group_id)
  );

create policy "workout_logs_update_own"
  on public.workout_logs for update
  to authenticated
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

-- ----------------------------------------------------------------------------
-- POSTS
-- Any group member can read/write within their group. Authors edit/delete own posts.
-- ----------------------------------------------------------------------------
create policy "posts_select_members"
  on public.posts for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "posts_insert_members"
  on public.posts for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.is_group_member(group_id)
  );

create policy "posts_update_own"
  on public.posts for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "posts_delete_own_or_coach"
  on public.posts for delete
  to authenticated
  using (author_id = auth.uid() or public.is_group_coach(group_id));

-- ----------------------------------------------------------------------------
-- COMMENTS
-- ----------------------------------------------------------------------------
create policy "comments_select_members"
  on public.comments for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "comments_insert_members"
  on public.comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.is_group_member(group_id)
  );

create policy "comments_update_own"
  on public.comments for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "comments_delete_own_or_coach"
  on public.comments for delete
  to authenticated
  using (author_id = auth.uid() or public.is_group_coach(group_id));

-- ----------------------------------------------------------------------------
-- REACTIONS
-- ----------------------------------------------------------------------------
create policy "reactions_select_members"
  on public.reactions for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "reactions_insert_members"
  on public.reactions for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and public.is_group_member(group_id)
  );

create policy "reactions_delete_own"
  on public.reactions for delete
  to authenticated
  using (profile_id = auth.uid());
