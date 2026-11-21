-- PASTE: step 213 (tape measurements: waist, hips, chest, arm and thigh for each client, read and written by the client and their coach). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.
-- If it stops with an error, run rollback; before trying again.

begin;

-- Wave 2, P6 (Ron, Nov 20): a few tape measurements with a graph. "Sometimes the scale doesn't move, but measurements show your body shape is changing."
--
--   * body_measurements: one row per person per day (like body_weight_logs), any of waist, hips, chest, arm and thigh, stored in inches whatever the person reads
--     them in (the app shows centimetres to a person who uses kilograms). At least one measurement on a row.
--   * The client and the client's coach read, add, change and delete them (the same rule as weigh-ins). A minor's writes follow the minor guard, and a coach working
--     in one organization sees only that organization's rows (the org wall), as for every body table.
--   * The row is the person's: "Download my data" and moving a client to another group pick it up on their own (both read every table with athlete_id and group_id),
--     and deleting the account removes it (on delete cascade). The coach's business export lists its tables by hand: it has body_measurements.csv (lib/business-export.ts).
-- Re-runnable.

create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  measured_on date not null default current_date,
  waist_in numeric(5, 2) check (waist_in is null or waist_in between 10 and 100),
  hips_in numeric(5, 2) check (hips_in is null or hips_in between 10 and 100),
  chest_in numeric(5, 2) check (chest_in is null or chest_in between 10 and 100),
  arm_in numeric(5, 2) check (arm_in is null or arm_in between 3 and 40),
  thigh_in numeric(5, 2) check (thigh_in is null or thigh_in between 5 and 60),
  entered_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_measurements_one_value check (num_nonnulls(waist_in, hips_in, chest_in, arm_in, thigh_in) > 0),
  constraint body_measurements_one_per_day unique (athlete_id, measured_on)
);
create index if not exists body_measurements_group_athlete_idx on public.body_measurements (group_id, athlete_id, measured_on desc);
create index if not exists body_measurements_entered_by_idx on public.body_measurements (entered_by);

alter table public.body_measurements enable row level security;
revoke all on public.body_measurements from anon;
grant select, insert, update, delete on public.body_measurements to authenticated;

drop policy if exists "body_measurements_select_own_or_coach" on public.body_measurements;
create policy "body_measurements_select_own_or_coach" on public.body_measurements for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
drop policy if exists "body_measurements_insert_own_or_coach" on public.body_measurements;
create policy "body_measurements_insert_own_or_coach" on public.body_measurements for insert to authenticated
  with check (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
drop policy if exists "body_measurements_update_own_or_coach" on public.body_measurements;
create policy "body_measurements_update_own_or_coach" on public.body_measurements for update to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id))
  with check (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
drop policy if exists "body_measurements_delete_own_or_coach" on public.body_measurements;
create policy "body_measurements_delete_own_or_coach" on public.body_measurements for delete to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

-- A minor's own writes follow the same guard as every other body table (0382, 0417).
drop policy if exists minor_write_guard_insert on public.body_measurements;
create policy minor_write_guard_insert on public.body_measurements as restrictive for insert to authenticated
  with check (public.minor_may_write((select auth.uid())));
drop policy if exists minor_write_guard_update on public.body_measurements;
create policy minor_write_guard_update on public.body_measurements as restrictive for update to authenticated
  using (public.minor_may_write((select auth.uid())))
  with check (public.minor_may_write((select auth.uid())));

-- The person must be in the group the row is filed under.
drop trigger if exists body_measurements_enforce_athlete_in_group on public.body_measurements;
create trigger body_measurements_enforce_athlete_in_group before insert or update on public.body_measurements
  for each row execute function public.enforce_athlete_in_group();

-- The org wall: a coach working in one organization sees only its rows.
do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'body_measurements' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.body_measurements as restrictive for all to authenticated
      using (public.group_in_active_org(group_id))
      with check (public.group_in_active_org(group_id));
  end if;
end;
$$;

-- The last change keeps its time.
create or replace function public.body_measurements_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.body_measurements_touch() from public, anon, authenticated;
drop trigger if exists body_measurements_touch on public.body_measurements;
create trigger body_measurements_touch before update on public.body_measurements
  for each row execute function public.body_measurements_touch();

commit;

-- Check: one row, all true.
select
  to_regclass('public.body_measurements') is not null as measurements_table,
  (select relrowsecurity from pg_class where oid = 'public.body_measurements'::regclass) as row_security_on,
  (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'body_measurements' and policyname like 'body_measurements_%_own_or_coach') as client_and_coach_rules,
  (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'body_measurements' and policyname like 'minor_write_guard_%' and permissive = 'RESTRICTIVE') as minor_guard,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'body_measurements' and policyname = 'org_wall_header' and permissive = 'RESTRICTIVE') as org_wall,
  exists (select 1 from pg_trigger where tgrelid = 'public.body_measurements'::regclass and tgname = 'body_measurements_enforce_athlete_in_group') as athlete_in_group,
  not has_table_privilege('anon', 'public.body_measurements', 'select') as nobody_signed_out,
  exists (select 1 from pg_constraint where conrelid = 'public.body_measurements'::regclass and conname = 'body_measurements_one_per_day') as one_row_a_day;
