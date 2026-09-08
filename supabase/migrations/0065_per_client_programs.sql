-- Per-client program assignment: a program can now belong to one specific
-- athlete (a personal, 1-on-1 copy) instead of only ever being shared by
-- the whole group. athlete_id null = today's behavior, completely
-- unchanged. Denormalized onto workouts/group_workout_exercises/
-- workout_notes the same way group_id already is, for the same reason
-- (cheap RLS without joining back to programs on every read).
--
-- Rather than threading athlete_id through every single insert call site
-- across the program builder (add week, add day, add exercise, bulk edit,
-- CSV import, AI import, duplicate week...) — a real risk of missing one
-- and silently leaking a personal program's content to the whole group —
-- a trigger auto-fills it from the parent row on every insert, so the
-- invariant holds regardless of which code path creates the row,
-- including future ones.

alter table public.programs add column athlete_id uuid references public.profiles(id) on delete cascade;
alter table public.workouts add column athlete_id uuid references public.profiles(id) on delete cascade;
alter table public.group_workout_exercises add column athlete_id uuid references public.profiles(id) on delete cascade;
alter table public.workout_notes add column athlete_id uuid references public.profiles(id) on delete cascade;
-- group_workout_exercise_sets gets no column — it already has no group_id
-- either, and its RLS already joins up to group_workout_exercises via
-- subquery (see gwes_select_members below), so extending that existing
-- join covers it without a new column.

create or replace function public.set_workout_athlete_id()
returns trigger language plpgsql as $$
begin
  select athlete_id into new.athlete_id from public.programs where id = new.program_id;
  return new;
end;
$$;
create trigger trg_set_workout_athlete_id before insert on public.workouts
for each row execute function public.set_workout_athlete_id();

create or replace function public.set_gwe_athlete_id()
returns trigger language plpgsql as $$
begin
  select athlete_id into new.athlete_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
create trigger trg_set_gwe_athlete_id before insert on public.group_workout_exercises
for each row execute function public.set_gwe_athlete_id();

create or replace function public.set_workout_notes_athlete_id()
returns trigger language plpgsql as $$
begin
  select athlete_id into new.athlete_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
create trigger trg_set_workout_notes_athlete_id before insert on public.workout_notes
for each row execute function public.set_workout_notes_athlete_id();

-- RLS: a personal program (and everything under it) is invisible to
-- everyone in the group except its one athlete and the coach. A shared
-- program (athlete_id null) is completely unchanged — visible to every
-- member exactly as today. Coach-write policies are untouched (a coach
-- already has full access within their own group).

drop policy "programs_select_members" on public.programs;
create policy "programs_select_members" on public.programs for select
  to authenticated using (
    public.is_group_member(group_id)
    and (athlete_id is null or athlete_id = auth.uid() or public.is_group_coach(group_id))
  );

drop policy "workouts_select_members" on public.workouts;
create policy "workouts_select_members" on public.workouts for select
  to authenticated using (
    public.is_group_member(group_id)
    and (athlete_id is null or athlete_id = auth.uid() or public.is_group_coach(group_id))
  );

drop policy "gwe_select_members" on public.group_workout_exercises;
create policy "gwe_select_members" on public.group_workout_exercises for select
  to authenticated using (
    public.is_group_member(group_id)
    and (athlete_id is null or athlete_id = auth.uid() or public.is_group_coach(group_id))
  );

drop policy "workout_notes_select_members" on public.workout_notes;
create policy "workout_notes_select_members" on public.workout_notes for select
  to authenticated using (
    public.is_group_member(group_id)
    and (athlete_id is null or athlete_id = auth.uid() or public.is_group_coach(group_id))
  );

drop policy "gwes_select_members" on public.group_workout_exercise_sets;
create policy "gwes_select_members" on public.group_workout_exercise_sets for select
  to authenticated using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_id
        and public.is_group_member(g.group_id)
        and (g.athlete_id is null or g.athlete_id = auth.uid() or public.is_group_coach(g.group_id))
    )
  );
