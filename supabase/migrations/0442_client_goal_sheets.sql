-- Step 197 (Ron, Nov 2: "a goal sheet coaches can fill out or send to clients and have them fill out").
-- One goal sheet per client per group, on the existing goal screens: why the goal matters, what success looks like in 90 days, what got in the way
-- before, how many days a week they can train, how bad they want it (1-10) and why that number, how hard they will work for it, and a quick recall
-- of the last 3 days of eating. The client fills it in, or the coach fills it in with them in a session; the coach can also send it, which tells
-- the client (bell + push).
-- The client and the coaches of the group read it. Nobody signed in writes it directly: the server (app/api/goal-sheet) checks who is asking (the
-- client for themselves, or a coach of the group for one of its clients) and saves it, and only a coach's send sets requested_by/requested_at.
-- Nothing here changes a program or a nutrition target. Like every table of group content it carries the organization-wall rule when that is
-- installed. Re-running is safe.

create table if not exists public.client_goal_sheets (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  why_matters text check (why_matters is null or char_length(why_matters) <= 2000),
  success_90_days text check (success_90_days is null or char_length(success_90_days) <= 2000),
  obstacles text check (obstacles is null or char_length(obstacles) <= 2000),
  days_per_week smallint check (days_per_week is null or days_per_week between 1 and 7),
  want_score smallint check (want_score is null or want_score between 1 and 10),
  want_why text check (want_why is null or char_length(want_why) <= 2000),
  work_willing text check (work_willing is null or char_length(work_willing) <= 2000),
  food_day_1 text check (food_day_1 is null or char_length(food_day_1) <= 2000),
  food_day_2 text check (food_day_2 is null or char_length(food_day_2) <= 2000),
  food_day_3 text check (food_day_3 is null or char_length(food_day_3) <= 2000),
  -- who last saved it and when (the client, or the coach filling it in with them); null until the first save
  filled_by uuid references public.profiles(id) on delete set null,
  filled_at timestamptz,
  -- the coach who last sent it to the client to fill in, and when
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz,
  created_at timestamptz not null default now(),
  unique (athlete_id, group_id)
);

alter table public.client_goal_sheets enable row level security;
revoke all on public.client_goal_sheets from anon;
revoke insert, update, delete, truncate on public.client_goal_sheets from authenticated;
grant select on public.client_goal_sheets to authenticated;

drop policy if exists "client_goal_sheets_read" on public.client_goal_sheets;
create policy "client_goal_sheets_read" on public.client_goal_sheets for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null then
    drop policy if exists "org_wall_header" on public.client_goal_sheets;
    create policy "org_wall_header" on public.client_goal_sheets as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;
