-- Team mode: the first slice of the team-sports expansion scoped earlier
-- (position groups + depth chart). Deliberately built on the existing
-- roster tables rather than a parallel "team" hierarchy — a team already
-- *is* a group here, so this adds the two things a group genuinely can't
-- express today: what position someone plays, and where they sit on the
-- depth chart at that position.
--
-- Positions are coach-defined per group rather than a hardcoded enum:
-- football's WR/OL/DB and basketball's PG/C are equally valid, and this
-- app's convention everywhere else (exercise_library.category,
-- tracked_fields) is already "the coach defines their own categories."

alter table public.groups
  add column team_mode boolean not null default false;

create table public.group_positions (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create index idx_group_positions_group on public.group_positions(group_id);

alter table public.group_memberships
  -- on delete set null: deleting a position must never delete the athlete
  -- from the roster, same principle as preserving history when a workout
  -- template is deleted (0035).
  add column position_id uuid references public.group_positions(id) on delete set null,
  -- Rank within their position: 1 = starter, 2 = second string, etc.
  -- Null = unranked (on the roster, not yet placed on the depth chart).
  add column depth_order int check (depth_order is null or depth_order > 0);

alter table public.group_positions enable row level security;

-- Same shape as every other group-scoped table: members read, coaches
-- manage. group_memberships.position_id/depth_order need no new policies —
-- the existing memberships_update_coach policy already covers any column.
create policy "group_positions_select_members" on public.group_positions for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "group_positions_write_coach" on public.group_positions for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
