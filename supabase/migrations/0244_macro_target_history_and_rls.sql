-- Standing macro targets become a dated history, and the write policy stops trusting any coach.
--
-- Two problems with 0239's client_macro_targets:
--   1. Its policy was is_group_coach(group_id) alone and its primary key was athlete_id alone. Any coach could
--      insert a row for any athlete's id (naming a group they coach), and the real coach's later upsert for that
--      athlete then collided with it and was refused.
--   2. One row per athlete meant editing protein on Wednesday rewrote Monday and Tuesday on the calendar and
--      in trends, because every day without its own row read the single current target.
--
-- Fix: a history table keyed (athlete_id, group_id, effective_from). A day shows the newest row whose
-- effective_from is on or before it. A row with every number null means "no standing target from this date".
-- Writes require the athlete to be a member of the group as well as the caller coaching it.
--
-- Safe to apply before the matching code is deployed: deployed code reads and writes client_macro_targets,
-- which keeps working (its policy is tightened, not removed), and new code falls back to that table until this
-- one exists.

create table if not exists public.client_macro_target_history (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  effective_from date not null,
  calories int check (calories is null or calories between 0 and 20000),
  protein_g int check (protein_g is null or protein_g between 0 and 1500),
  carbs_g int check (carbs_g is null or carbs_g between 0 and 3000),
  fat_g int check (fat_g is null or fat_g between 0 and 1500),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (athlete_id, group_id, effective_from)
);

create index if not exists client_macro_target_history_group_id_idx
  on public.client_macro_target_history(group_id);

alter table public.client_macro_target_history enable row level security;

-- The coach of the group manages targets for athletes who belong to that group, and only those.
create policy "client_macro_target_history_coach_manage" on public.client_macro_target_history for all
  to authenticated
  using (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_target_history.group_id
        and gm.profile_id = client_macro_target_history.athlete_id
    )
  )
  with check (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_target_history.group_id
        and gm.profile_id = client_macro_target_history.athlete_id
    )
  );

-- The athlete reads their own history (the coach sets it).
create policy "client_macro_target_history_athlete_select" on public.client_macro_target_history for select
  to authenticated
  using (athlete_id = (select auth.uid()));

-- Carry every existing standing target across as the first history row, effective the day it was saved.
insert into public.client_macro_target_history
  (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by)
select t.athlete_id, t.group_id, t.updated_at::date, t.calories, t.protein_g, t.carbs_g, t.fat_g, t.updated_by
from public.client_macro_targets t
where exists (
  select 1 from public.group_memberships gm
  where gm.group_id = t.group_id and gm.profile_id = t.athlete_id
)
on conflict do nothing;

-- Tighten the old table the same way so a coach can no longer plant a row for an athlete outside their group.
-- Reads and the athlete's own select policy are unchanged.
drop policy if exists "client_macro_targets_coach_manage" on public.client_macro_targets;
create policy "client_macro_targets_coach_manage" on public.client_macro_targets for all
  to authenticated
  using (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_targets.group_id
        and gm.profile_id = client_macro_targets.athlete_id
    )
  )
  with check (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_targets.group_id
        and gm.profile_id = client_macro_targets.athlete_id
    )
  );

-- Any row already planted for an athlete who isn't in the named group is junk; remove it so the real coach's
-- upsert is not blocked by it.
delete from public.client_macro_targets t
where not exists (
  select 1 from public.group_memberships gm
  where gm.group_id = t.group_id and gm.profile_id = t.athlete_id
);
