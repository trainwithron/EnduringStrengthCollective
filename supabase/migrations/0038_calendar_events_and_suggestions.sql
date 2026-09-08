-- Freeform calendar events (custom reminders/tasks/notes a coach adds
-- directly, plus system-suggested items once acted on) — additive to the
-- existing bookings-only calendar. Coach-scoped, not group-scoped, same
-- as bookings already are: a coach's calendar is one calendar across
-- every group they run, regardless of which group's URL it's viewed from.
create table public.calendar_events (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  notes text,
  event_date date not null,
  event_time time,
  event_type text not null default 'custom' check (event_type in ('custom', 'suggestion')),
  linked_athlete_id uuid references public.profiles(id) on delete set null,
  linked_group_id uuid references public.groups(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.calendar_events enable row level security;

create policy "calendar_events_owner" on public.calendar_events for all
  to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

-- One row per coach: how proactive suggestions ("Alice's program ends
-- Friday, assign her next one") should behave. Defaults match the
-- original ask verbatim — a few days' notice, shown as a list rather
-- than dropped onto the calendar unasked.
create table public.coach_preferences (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  suggestion_mode text not null default 'list' check (suggestion_mode in ('list', 'auto_add')),
  suggestion_lead_days int not null default 3 check (suggestion_lead_days >= 0),
  updated_at timestamptz not null default now()
);

alter table public.coach_preferences enable row level security;

create policy "coach_preferences_owner" on public.coach_preferences for all
  to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());
