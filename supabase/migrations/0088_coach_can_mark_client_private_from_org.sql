-- Follow-up to the cascading session-visibility fix (0087): by default a
-- client's full session detail stays visible up the org hierarchy (owner
-- oversees their coaches — that's the actual reason the cascade was
-- built), but a coach can now mark one specific client relationship as
-- private, which blocks the org-admin/platform-admin cascade for that one
-- (group, athlete) pair. Opt-out, not opt-in — chosen deliberately over a
-- default-private model: requiring a coach to proactively "share up"
-- would mean a coach could simply never share, defeating the oversight
-- this was built for in the first place. This just gives a real escape
-- hatch for the genuine edge case (a sensitive circumstance, a personal
-- connection) without weakening the default.
--
-- "Private" here means private from the whole hierarchy above the coach,
-- platform admin included — a coach marking something private should mean
-- what it says, not "private except from the very top."
alter table public.group_memberships
  add column private_from_org boolean not null default false;

-- Coaches can already update any column on their own group's memberships
-- (memberships_update_coach has no column restriction), so no RLS change
-- is needed for a coach to set this themselves.

create or replace function public.is_client_private_from_org(_group_id uuid, _athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select private_from_org from public.group_memberships
     where group_id = _group_id and profile_id = _athlete_id),
    false
  );
$$;

drop policy if exists "sessions_select_own_or_coach" on public.athlete_sessions;
create policy "sessions_select_own_or_coach"
  on public.athlete_sessions for select
  to authenticated
  using (
    athlete_id = auth.uid()
    or is_group_coach(group_id)
    or (
      (is_org_admin_of_group(group_id) or is_platform_admin())
      and not is_client_private_from_org(group_id, athlete_id)
    )
  );

drop policy if exists "session_exercises_select_own_or_coach" on public.session_exercises;
create policy "session_exercises_select_own_or_coach"
  on public.session_exercises for select
  to authenticated
  using (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and (
          s.athlete_id = auth.uid()
          or is_group_coach(s.group_id)
          or (
            (is_org_admin_of_group(s.group_id) or is_platform_admin())
            and not is_client_private_from_org(s.group_id, s.athlete_id)
          )
        )
    )
  );

drop policy if exists "set_logs_select_own_or_coach" on public.set_logs;
create policy "set_logs_select_own_or_coach"
  on public.set_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and (
          s.athlete_id = auth.uid()
          or is_group_coach(s.group_id)
          or (
            (is_org_admin_of_group(s.group_id) or is_platform_admin())
            and not is_client_private_from_org(s.group_id, s.athlete_id)
          )
        )
    )
  );

drop policy if exists "gwe_select_members" on public.group_workout_exercises;
create policy "gwe_select_members"
  on public.group_workout_exercises for select
  to authenticated
  using (
    (is_group_member(group_id) and (athlete_id is null or athlete_id = auth.uid() or is_group_coach(group_id)))
    or (
      (is_org_admin_of_group(group_id) or is_platform_admin())
      and (athlete_id is null or not is_client_private_from_org(group_id, athlete_id))
    )
  );

drop policy if exists "gwes_select_members" on public.group_workout_exercise_sets;
create policy "gwes_select_members"
  on public.group_workout_exercise_sets for select
  to authenticated
  using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_sets.group_workout_exercise_id
        and (
          (is_group_member(g.group_id) and (g.athlete_id is null or g.athlete_id = auth.uid() or is_group_coach(g.group_id)))
          or (
            (is_org_admin_of_group(g.group_id) or is_platform_admin())
            and (g.athlete_id is null or not is_client_private_from_org(g.group_id, g.athlete_id))
          )
        )
    )
  );
