-- acuity_replacement_gap_audit_sept16.md — credit-expiration window, the
-- next slice after buffer/minimum-notice (already shipped). Design
-- already resolved: per-coach configurable on coach_booking_policies,
-- same shape as cancellation_window_hours/buffer_minutes/
-- minimum_notice_hours. Deliberately a coarse "whole balance expires N
-- days after the most recent grant" model, not a per-purchase-batch
-- ledger — session_credits is a single aggregate integer with no
-- per-grant lineage today, and re-architecting it into a FIFO ledger
-- would be a much bigger, riskier change than this gap calls for. This
-- matches how many real booking/credit systems actually communicate
-- expiration to a client ("your credits expire N days after your last
-- purchase"), not per-unit tracking.
--
-- Defaults (credit_expiry_days = 0, last_granted_at = null for every
-- existing row) mean this is a no-op for every coach/client today unless
-- a coach deliberately opts in.
alter table public.coach_booking_policies
  add column credit_expiry_days int not null default 0 check (credit_expiry_days >= 0);

alter table public.session_credits
  add column last_granted_at timestamptz;

-- adjust_session_credits (0064) reproduced byte-for-byte except for the
-- one new line: any positive delta (a real grant — Stripe purchase,
-- subscription renewal, a coach's manual +) stamps last_granted_at.
-- cancel_booking_and_refund_credit's own direct insert is deliberately
-- NOT touched — a cancellation refund returns a credit already granted
-- earlier, it isn't new value, so it shouldn't reset the expiry clock.
create or replace function public.adjust_session_credits(
  p_athlete_id uuid,
  p_group_id uuid,
  p_delta int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if auth.uid() = p_athlete_id and p_delta > 0 then
    raise exception 'not authorized to increase your own session credits directly';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to adjust these session credits';
  end if;

  insert into public.session_credits (athlete_id, group_id, balance, last_granted_at)
  values (p_athlete_id, p_group_id, greatest(0, p_delta), case when p_delta > 0 then now() else null end)
  on conflict (athlete_id, group_id)
  do update set
    balance = greatest(0, public.session_credits.balance + p_delta),
    last_granted_at = case when p_delta > 0 then now() else public.session_credits.last_granted_at end,
    updated_at = now()
  returning balance into new_balance;

  return new_balance;
end;
$$;

-- Real, visible audit trail for every expiration — same transparency
-- principle as credit_purchases (never silently zero a client's balance
-- with no record of it happening). No authenticated write policy at
-- all — only the service-role expiration cron ever inserts here.
create table public.session_credit_expirations (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  credits_expired int not null check (credits_expired > 0),
  expired_at timestamptz not null default now()
);
create index session_credit_expirations_athlete_id_idx on public.session_credit_expirations(athlete_id);
create index session_credit_expirations_group_id_idx on public.session_credit_expirations(group_id);

alter table public.session_credit_expirations enable row level security;
create policy "session_credit_expirations_select_own_or_coach" on public.session_credit_expirations for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired'
  ));
