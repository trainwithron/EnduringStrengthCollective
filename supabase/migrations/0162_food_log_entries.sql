-- Real food logging (calorie_tracking_ux_research_and_plan.md, V1,
-- approved 2026-09-14) — this app had zero food-logging UI before this,
-- just a target-setting form. Core insight the whole feature is built
-- around: logging friction, not data accuracy, is what kills calorie
-- trackers — a coached athlete already has a prescribed meal to check
-- off, not a database to search. `status = 'ate_it'` is the flagship
-- path (zero typing, zero search — the logged macros are just the
-- meal's own prescribed target); 'modified' and 'quick_log' cover
-- deviations, resolved via AI estimation (app/api/ai/parse-food-log)
-- rather than a real USDA ingredient database, which is its own,
-- larger, deliberately-deferred project.
create table public.food_log_entries (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  log_date date not null,
  meal_slot text, -- e.g. "breakfast"/"lunch"/"dinner"/"snack" — null for a free-standing quick-log not tied to a planned meal
  status text not null check (status in ('ate_it', 'modified', 'skipped', 'quick_log')),
  description text, -- what was actually eaten; null for a plain "ate it as prescribed"
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  created_at timestamptz not null default now()
);
create index food_log_entries_athlete_date_idx on public.food_log_entries(athlete_id, log_date);

alter table public.food_log_entries enable row level security;

create policy "food_log_entries_select_own_or_coach" on public.food_log_entries for select
  to authenticated using (athlete_id = auth.uid() or public.is_group_coach(group_id));
-- Self-reported, same model as wellness_checkins — a coach can read it
-- (for adherence-days auto-derivation, per-athlete review) but never
-- write on an athlete's behalf; there's nothing for a coach to "correct"
-- in what someone actually ate.
create policy "food_log_entries_write_own" on public.food_log_entries for all
  to authenticated using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());
