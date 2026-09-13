-- AI Assistant Slice 2 ("Collective Intelligence" — The Briefing).
-- One anchor row per (coach, date); the real per-athlete content lives in
-- coach_briefing_items so RLS can gate visibility per-athlete the same
-- way every other athlete-scoped table in this app already does
-- (is_group_coach + the org-admin-cascade pattern already used for
-- wearable data), rather than needing to redact a JSONB blob per viewer.

create table public.coach_briefings (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  briefing_date date not null,
  created_at timestamptz not null default now(),
  unique (coach_id, briefing_date)
);

create table public.coach_briefing_items (
  id uuid primary key default uuid_generate_v4(),
  briefing_id uuid not null references public.coach_briefings(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  item_type text not null check (item_type in ('observation', 'reflective_question', 'celebration')),
  headline text not null,
  -- Which spotter(s)/signal ids this item traces back to — the
  -- numeral-hallucination guard checks any number in `headline` against
  -- the real values behind these ids before the row is ever inserted,
  -- not enforced here (not SQL-expressible), but every item is required
  -- to cite at least one.
  signal_ids text[] not null default '{}',
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  check (array_length(signal_ids, 1) > 0)
);
create index coach_briefing_items_briefing_id_idx on public.coach_briefing_items(briefing_id);
create index coach_briefing_items_athlete_id_idx on public.coach_briefing_items(athlete_id);
create index coach_briefing_items_group_id_idx on public.coach_briefing_items(group_id);

alter table public.coach_briefings enable row level security;
-- Only the generating coach can see their own anchor row; only the
-- service-role cron ever writes it (no authenticated insert/update/delete
-- policy at all), same as every other cron-owned table in this app.
create policy "coach_briefings_select_own" on public.coach_briefings for select
  to authenticated using (coach_id = (select auth.uid()));

alter table public.coach_briefing_items enable row level security;
-- Visible to whichever coach(es) are actually assigned/staffing this
-- specific athlete's group (is_group_coach — covers every co-staffing
-- coach, not just whichever one's own cron run generated the row),
-- cascading up to an org admin/owner on top, respecting the same
-- "keep this client private from the org" toggle every other
-- athlete-scoped table already respects.
create policy "coach_briefing_items_select_assigned_or_cascade" on public.coach_briefing_items for select
  to authenticated using (
    is_group_coach(group_id)
    or (
      not is_client_private_from_org(group_id, athlete_id)
      and (is_org_admin_of_group(group_id) or is_platform_admin())
    )
  );
