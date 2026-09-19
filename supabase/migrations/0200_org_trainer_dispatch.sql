-- org_calendar_spotter_trainer_dispatch_scoping_sept19.md — an org-level
-- extension of the already-shipped Calendar Spotter: a public intake
-- page lets a prospect request a day/time + goal, and the org's
-- trainers get cascaded, ranked (best-goal-fit-first) push
-- notifications to accept/decline/ask a question, one at a time, until
-- one accepts or nobody does.
--
-- Genuinely new — lib/calendar-spotter.ts is a pure, read-only
-- attendance-drift detector with zero existing dispatch/cascade
-- machinery; this is net-new on top of it, not an extension of
-- existing code.

-- Gym-owner-configurable, per Ron's own resolution — not a hardcoded
-- constant. Same "configurable window, sane default, positive check"
-- shape as coach_booking_policies.cancellation_window_hours (0068).
alter table public.organizations
  add column dispatch_ttl_minutes int not null default 20 check (dispatch_ttl_minutes > 0);

-- One row per prospect intake submission. No anon SELECT policy at
-- all — prospect email/phone must never be publicly readable, same
-- trust model as discovery_bookings (0089) and gym_visitor_leads (0199).
create table public.org_trainer_dispatch_requests (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_name text not null,
  prospect_email text not null,
  prospect_phone text,
  prospect_timezone text not null,
  requested_start_at timestamptz not null,
  goal_type text not null check (
    goal_type in ('weight_loss', 'body_recomp', 'muscle_gain', 'bodybuilding', 'powerbuilding_strongman', 'endurance_event', 'custom')
  ),
  goal_custom_label text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'matched', 'no_trainer_available', 'cancelled')),
  matched_trainer_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index org_trainer_dispatch_requests_org_idx on public.org_trainer_dispatch_requests(organization_id);

alter table public.org_trainer_dispatch_requests enable row level security;
create policy "org_trainer_dispatch_requests_select_org_member" on public.org_trainer_dispatch_requests for select
  to authenticated using (public.is_org_member(organization_id));
-- No authenticated insert/update policy — the public submit route uses
-- the service-role client (candidate-ranking needs real TS date/
-- timezone logic across every trainer's own availability, which isn't
-- practical to reimplement in plpgsql the way book_discovery_call's
-- simple validation was — a deliberate deviation from the anon-RPC
-- convention used elsewhere, noted here so it isn't mistaken for an
-- oversight). Steps are advanced by the service-role cron/trainer
-- response routes, not direct client writes.

-- Cascade state: one row per trainer actually dispatched to for a
-- given request, in ranked order. Only the assigned trainer (or the
-- org owner/admin, for visibility) can read/act on their own step.
create table public.org_trainer_dispatch_steps (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid not null references public.org_trainer_dispatch_requests(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (request_id, trainer_id)
);
create index org_trainer_dispatch_steps_pending_idx on public.org_trainer_dispatch_steps(status, expires_at) where status = 'pending';

alter table public.org_trainer_dispatch_steps enable row level security;
create policy "org_trainer_dispatch_steps_select_own_or_org_admin" on public.org_trainer_dispatch_steps for select
  to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.org_trainer_dispatch_requests r
      join public.organization_memberships om on om.organization_id = r.organization_id
      where r.id = org_trainer_dispatch_steps.request_id
        and om.profile_id = (select auth.uid())
        and om.role = any (array['owner'::org_member_role, 'admin'::org_member_role])
    )
  );
-- A trainer can only update their OWN step, and only while it's still
-- pending — accepting/declining a step that already expired or was
-- someone else's is rejected at the database level, not just hidden by
-- the UI.
create policy "org_trainer_dispatch_steps_update_own_pending" on public.org_trainer_dispatch_steps for update
  to authenticated using (trainer_id = (select auth.uid()) and status = 'pending')
  with check (trainer_id = (select auth.uid()));

-- The 3-way "ask a question" loop. A trainer's own question; the
-- prospect's answer is recorded by the service-role reply route (they
-- have no account/session at all) via a token — see below.
create table public.org_trainer_dispatch_questions (
  id uuid primary key default uuid_generate_v4(),
  step_id uuid not null references public.org_trainer_dispatch_steps(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id),
  reply_token uuid not null default uuid_generate_v4(),
  question text not null,
  answer text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create unique index org_trainer_dispatch_questions_reply_token_idx on public.org_trainer_dispatch_questions(reply_token);

alter table public.org_trainer_dispatch_questions enable row level security;
create policy "org_trainer_dispatch_questions_select_participant" on public.org_trainer_dispatch_questions for select
  to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1 from public.org_trainer_dispatch_steps s
      join public.org_trainer_dispatch_requests r on r.id = s.request_id
      join public.organization_memberships om on om.organization_id = r.organization_id
      where s.id = org_trainer_dispatch_questions.step_id
        and om.profile_id = (select auth.uid())
        and om.role = any (array['owner'::org_member_role, 'admin'::org_member_role])
    )
  );
create policy "org_trainer_dispatch_questions_insert_own" on public.org_trainer_dispatch_questions for insert
  to authenticated with check (
    trainer_id = (select auth.uid())
    and exists (select 1 from public.org_trainer_dispatch_steps s where s.id = step_id and s.trainer_id = (select auth.uid()))
  );
-- No authenticated UPDATE policy at all — the prospect's answer is
-- written only by the service-role reply route (token-gated, no
-- session to check RLS against, same shape as guardian_links).

-- Widen the notifications type list once more for the two real,
-- trainer-facing dispatch events (a fan-out-to-every-owner trigger like
-- gym_visitor_lead's doesn't fit here — a cascade notifies ONE trainer
-- at a time, so these are inserted directly from the application/cron
-- code that already knows exactly who to notify, not a blanket trigger).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question'
  ));
