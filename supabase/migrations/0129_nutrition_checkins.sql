-- Weekly Check-In engine (Phase 4 of the Home/Nutrition redesign) —
-- one row per coach-run check-in event, so "this week's" and "last
-- week's" average weight/recovery can be pulled from real logged data
-- next time, and the hypertrophy phase's consecutive-spike-week
-- counter has somewhere real to persist between check-ins (it's
-- per-athlete running state in the source tool, kept in localStorage
-- there since it had no backend at all).
create table public.nutrition_checkins (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  phase text not null check (phase in ('fat_loss', 'hypertrophy', 'maintenance')),
  prev_weight_lbs numeric not null,
  curr_weight_lbs numeric not null,
  current_calories int not null,
  adherence_days smallint not null check (adherence_days between 0 and 7),
  recovery_rating smallint not null check (recovery_rating between 1 and 5),
  new_calories int not null,
  rationale text not null,
  consecutive_surplus_spikes smallint not null default 0,
  diet_archetype text not null default 'standard' check (diet_archetype in ('standard', 'keto', 'carnivore')),
  protein_g int not null,
  carbs_g int not null,
  fat_g int not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index nutrition_checkins_athlete_id_idx on public.nutrition_checkins(athlete_id);
create index nutrition_checkins_group_id_idx on public.nutrition_checkins(group_id);

alter table public.nutrition_checkins enable row level security;

-- Same coach-manage / athlete-read-only shape as every other coach-
-- authored per-client record in this app (e.g. daily_macros, athlete_notes) —
-- a check-in is the coach's own judgment call (adherence/recovery are
-- manually entered), not something the athlete edits.
create policy "nutrition_checkins_select_own_or_coach" on public.nutrition_checkins for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "nutrition_checkins_write_coach" on public.nutrition_checkins for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
