-- Nutrition check-in engine: a real 4th phase, reverse_diet — confirmed
-- gap (running a reverse diet through fat_loss/hypertrophy today
-- produces actively wrong advice). Also the proactive-suggestion queue:
-- a weekly cron runs the engine automatically per tracked athlete and
-- lands a pending recommendation here, never writing daily_macros
-- directly — a coach's explicit "Apply" is still required, same human-
-- approval gate the manual panel already has.
alter table public.nutrition_checkins drop constraint nutrition_checkins_phase_check;
alter table public.nutrition_checkins add constraint nutrition_checkins_phase_check
  check (phase in ('fat_loss', 'hypertrophy', 'maintenance', 'reverse_diet'));

create table public.nutrition_checkin_suggestions (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  phase text not null check (phase in ('fat_loss', 'hypertrophy', 'maintenance', 'reverse_diet')),
  prev_weight_lbs numeric not null,
  curr_weight_lbs numeric not null,
  current_calories int not null,
  adherence_days smallint not null check (adherence_days between 0 and 7),
  recovery_rating smallint not null check (recovery_rating between 1 and 5),
  consecutive_surplus_spikes smallint not null default 0,
  new_calories int not null,
  rationale text not null,
  protein_g int not null,
  carbs_g int not null,
  fat_g int not null,
  diet_archetype text not null default 'standard' check (diet_archetype in ('standard', 'keto', 'carnivore')),
  dietary_restrictions text not null default '',
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  generated_at timestamptz not null default now()
);
create index nutrition_checkin_suggestions_group_id_idx on public.nutrition_checkin_suggestions(group_id);
create index nutrition_checkin_suggestions_athlete_id_idx on public.nutrition_checkin_suggestions(athlete_id);

alter table public.nutrition_checkin_suggestions enable row level security;

-- Coach-only end to end — same shape as nutrition_checkins itself. An
-- athlete never sees a draft suggestion, only the applied result
-- (which lands in nutrition_checkins/daily_macros exactly like a
-- manually-run check-in already does).
create policy "checkin_suggestions_select_coach" on public.nutrition_checkin_suggestions for select
  to authenticated using (public.is_group_coach(group_id));
create policy "checkin_suggestions_write_coach" on public.nutrition_checkin_suggestions for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
