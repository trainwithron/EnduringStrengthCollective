-- One row per athlete per day, same shape/upsert convention as
-- body_weight_logs (0016_client_profile.sql) — no "due" concept, unlike
-- client_habits, since every athlete can check in every day.
--
-- Directionality: all three fields are stored so higher always means
-- better. sleep_quality 5 = great sleep, energy 5 = high energy, and
-- soreness 5 = fresh/no soreness (1 = very sore) — the opposite of how
-- "soreness" reads colloquially, chosen so a simple average of the three
-- fields is a meaningful single readiness score.
create table public.wellness_checkins (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  log_date date not null default current_date,
  sleep_quality smallint not null check (sleep_quality between 1 and 5),
  soreness smallint not null check (soreness between 1 and 5),
  energy smallint not null check (energy between 1 and 5),
  created_at timestamptz not null default now(),
  unique (athlete_id, group_id, log_date)
);

create index wellness_checkins_group_id_idx on public.wellness_checkins(group_id);
create index wellness_checkins_athlete_id_idx on public.wellness_checkins(athlete_id);

alter table public.wellness_checkins enable row level security;

create policy "wellness_checkins_select_own_or_coach" on public.wellness_checkins for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

create policy "wellness_checkins_write_own" on public.wellness_checkins for all
  to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));

-- A coach can also write on an athlete's behalf, same as body_weight_logs
-- (0016_client_profile.sql) — needed for the already-shipped "View as
-- Client" mode, where a coach standing with a client helps them fill this
-- out on the coach's own device. Kept as a second permissive policy
-- (Postgres ORs them) rather than folding into the one above, matching
-- this app's existing pattern of a later pass consolidating permissive
-- policies (0110/0111) rather than always writing one from scratch.
create policy "wellness_checkins_coach_write" on public.wellness_checkins for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
