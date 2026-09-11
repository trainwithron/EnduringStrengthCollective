-- Training partner matching — the first cross-org, platform-wide-visible
-- feature in this app. Everything else is scoped to one coach's org/group;
-- this deliberately opens a narrow, opt-in exception to that: an athlete
-- who turns this on becomes discoverable by any other opted-in athlete
-- on the platform, regardless of coach. Real research backing: couples
-- training together have a 6.3% dropout rate vs. 43% alone.

-- Platform-wide opt-in directory entry. Deliberately its own table, not
-- columns on athlete_profile_details (0108) — that table's RLS is
-- coach-scoped (is_coach_of_athlete), the opposite of what this needs.
create table public.training_partner_profiles (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  visible boolean not null default false,
  location_text text,
  looking_for text,
  updated_at timestamptz not null default now()
);

create table public.training_partner_requests (
  id uuid primary key default uuid_generate_v4(),
  from_athlete_id uuid not null references public.profiles(id) on delete cascade,
  to_athlete_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  message text not null,
  -- The recipient's own contact info/note, added when they accept —
  -- matching is mutual, so both sides share, not just the requester.
  response_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_athlete_id <> to_athlete_id),
  unique (from_athlete_id, to_athlete_id)
);

create table public.training_partner_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Write-only from the app's side, deliberately no authenticated select
-- policy — reviewed directly via execute_sql, same "no dashboard needed"
-- discipline as the rest of this app's safety-adjacent features.
create table public.training_partner_reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Real bug caught in live testing: a raw EXISTS subquery against
-- training_partner_blocks inside another table's RLS policy is ITSELF
-- subject to training_partner_blocks' own RLS (blocker_id = auth.uid()
-- only) — meaning a blocked user's restricted view can see blocks THEY
-- created but never blocks created against THEM, so they could still
-- message the person who blocked them. Same reason this codebase's
-- is_group_coach/is_client_of_coach are security definer: a relationship
-- check spanning both parties needs to run with elevated privileges,
-- not through either party's own RLS-filtered view.
create or replace function public.training_partners_mutually_blocked(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.training_partner_blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

alter table public.training_partner_profiles enable row level security;
create policy "training_partner_profiles_select_visible" on public.training_partner_profiles for select
  to authenticated using (
    visible = true
    and not public.training_partners_mutually_blocked(athlete_id, (select auth.uid()))
  );
create policy "training_partner_profiles_select_own" on public.training_partner_profiles for select
  to authenticated using (athlete_id = (select auth.uid()));
create policy "training_partner_profiles_write_own" on public.training_partner_profiles for all
  to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));

alter table public.training_partner_requests enable row level security;
create policy "training_partner_requests_select_participant" on public.training_partner_requests for select
  to authenticated using (from_athlete_id = (select auth.uid()) or to_athlete_id = (select auth.uid()));
create policy "training_partner_requests_insert_own" on public.training_partner_requests for insert
  to authenticated with check (
    from_athlete_id = (select auth.uid())
    and not public.training_partners_mutually_blocked(to_athlete_id, (select auth.uid()))
  );
create policy "training_partner_requests_update_recipient" on public.training_partner_requests for update
  to authenticated using (to_athlete_id = (select auth.uid())) with check (to_athlete_id = (select auth.uid()));

alter table public.training_partner_blocks enable row level security;
create policy "training_partner_blocks_own" on public.training_partner_blocks for all
  to authenticated using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

alter table public.training_partner_reports enable row level security;
create policy "training_partner_reports_insert_own" on public.training_partner_reports for insert
  to authenticated with check (reporter_id = (select auth.uid()));

-- notifications.group_id is NOT NULL today (0071) — every existing type
-- has a natural group. A cross-org partner request has none.
alter table public.notifications alter column group_id drop not null;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment', 'program_assigned', 'macros_assigned', 'partner_request', 'partner_request_accepted'));

create or replace function public.notify_on_partner_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from_name text;
begin
  if tg_op = 'INSERT' then
    select full_name into v_from_name from public.profiles where id = new.from_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (new.to_athlete_id, null, 'partner_request',
      coalesce(v_from_name, 'Someone') || ' wants to be your training partner',
      '/partners/requests');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    select full_name into v_from_name from public.profiles where id = new.to_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (new.from_athlete_id, null, 'partner_request_accepted',
      coalesce(v_from_name, 'Someone') || ' accepted your training partner request',
      '/partners/requests');
  end if;
  return new;
end;
$$;
create trigger trg_notify_on_partner_request
  after insert or update on public.training_partner_requests
  for each row execute function public.notify_on_partner_request();
