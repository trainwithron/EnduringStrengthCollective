-- RELEASE M1 (FAILED PAYMENTS, REFUNDS AND DISPUTES RECORDED AND THE COACH TOLD; ADDS ONE TABLE AND ONE NOTICE KIND, MOVES NO MONEY, SAFE BEFORE THE CODE): ONE paste. Steps 161 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 161: Nothing changes on screen until the Release M1 code is live. Adds one table (payment_events: a record of each failed payment, refund and dispute Stripe reports, a coach reads their own groups') and a read-only report for the platform admin. It moves no money and changes no balance. After the code is live, switch on four more event types for the webhook in the Stripe dashboard (invoice.payment_failed, charge.refunded, charge.dispute.created, charge.dispute.closed).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release M1 (failed payments, refunds and disputes recorded and the coach told; adds one table and one notice kind, moves no money, safe before the code), step 161: 0409 Release M1: failed payments, refunds and disputes are recorded and the coach is told (a ledger of money events, one new kind of notice, a platform report); no money moves
do $g161$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0409 is not already applied (the money events table is not there yet)', to_regclass('public.payment_events') is null),
      ('the tables and helpers it uses exist', to_regclass('public.groups') is not null and to_regclass('public.profiles') is not null and to_regclass('public.membership_subscriptions') is not null and to_regclass('public.group_memberships') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null),
      ('the notification type rule exists to be widened', exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release M1 (failed payments, refunds and disputes recorded and the coach told; adds one table and one notice kind, moves no money, safe before the code), step 161 (0409) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g161$;

-- ====================================================================================================
-- migration 0409_payment_events.sql
-- ====================================================================================================

-- Release M1: money events the coach and the platform must be able to see, recorded and nothing more.
--
-- Until now a client's failed payment, a refund made in Stripe, or a dispute (a chargeback) left no trace in the app: the coach found out from their bank. This records each of them as it happens and tells the coach, and
-- gives the platform admin four read-only checks that catch money that is out of step with who is in the app. It MOVES NO MONEY and changes no balance: a refund is recorded, it does not take sessions back; a failed payment
-- is recorded, it does not end access. Those are decisions for the coach (and Ron), listed in docs/NEEDS_RON.md.
--   payment_events      one row per event Stripe sent (stripe_event_id is unique, so a redelivery is a harmless duplicate). A coach reads the rows of their own groups; a client reads their own; nothing is written from a browser.
--   'payment_problem'   a new kind of bell notice (added to the allowed list; the existing kinds are kept exactly).
--   payment_reconciliation_report()   platform admin only: four checks, each with a count and an example.
-- Additions only (the notice list is rebuilt from the live list plus one). Re-runnable.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  kind text not null check (kind in ('payment_failed', 'refund', 'dispute_opened', 'dispute_closed')),
  group_id uuid references public.groups(id) on delete set null,
  athlete_id uuid references public.profiles(id) on delete set null,
  coach_id uuid references public.profiles(id) on delete set null,
  -- this event's own amount (for a refund: this refund); total_cents: everything refunded on the charge so far
  amount_cents int,
  total_cents int,
  currency text,
  stripe_object_id text,
  subscription_id text,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists payment_events_group_idx on public.payment_events (group_id, created_at desc);
create index if not exists payment_events_object_idx on public.payment_events (stripe_object_id) where stripe_object_id is not null;
create index if not exists payment_events_subscription_idx on public.payment_events (subscription_id) where subscription_id is not null;
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;
grant select on public.payment_events to authenticated;
drop policy if exists "payment_events_select_coach_or_own" on public.payment_events;
create policy "payment_events_select_coach_or_own" on public.payment_events for select to authenticated
  using (
    athlete_id = (select auth.uid())
    -- a group's events: its coaches, and the owner or an admin of its organization (the Business page of an owner or admin counts the whole organization); a coach who has left the group no longer reads them
    or (group_id is not null and (public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id)))
    -- the coach's own plan (no group)
    or (group_id is null and coach_id = (select auth.uid()))
  );

-- One new kind of notice: a payment problem (failed payment, refund, dispute). The list is rebuilt from the live one plus this kind, and refused if it would lose any.
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['payment_problem']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

-- Four read-only checks for the platform admin. Each returns what it checked, how many rows are out of step, and one example id.
-- "Past due for more than 7 days" is counted from the FIRST failed payment recorded for the subscription (the subscription row itself is rewritten on every update, so its own date says nothing); a subscription that went past due before
-- failed payments were being recorded has no date to count from and is not counted.
create or replace function public.payment_reconciliation_report()
returns table (check_name text, what text, issue_count bigint, example text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_platform_admin) then
    raise exception 'Only a platform administrator can read this report.';
  end if;

  return query
  select 'refund_not_attributed'::text,
         'Refunds Stripe reported that could not be matched to a client and group'::text,
         count(*), (array_agg(e.stripe_object_id order by e.created_at desc))[1]
    from public.payment_events e where e.kind = 'refund' and (e.group_id is null or e.athlete_id is null);

  return query
  select 'past_due_over_7_days'::text,
         'Subscriptions past due, with a failed payment first recorded more than 7 days ago'::text,
         count(*), (array_agg(s.stripe_subscription_id order by s.stripe_subscription_id))[1]
    from public.membership_subscriptions s
    where s.status = 'past_due'
      and (select min(e.created_at) from public.payment_events e where e.kind = 'payment_failed' and e.subscription_id = s.stripe_subscription_id) < now() - interval '7 days';

  return query
  select 'billing_after_leaving'::text,
         'Subscriptions still billing a person who is no longer a client of the group'::text,
         count(*), (array_agg(s.stripe_subscription_id order by s.stripe_subscription_id))[1]
    from public.membership_subscriptions s
    where s.status in ('active', 'past_due', 'paused')
      and not exists (select 1 from public.group_memberships gm where gm.group_id = s.group_id and gm.profile_id = s.athlete_id);

  return query
  select 'dispute_open'::text,
         'Disputes opened and not yet closed'::text,
         count(*), (array_agg(o.stripe_object_id order by o.created_at desc))[1]
    from public.payment_events o
    where o.kind = 'dispute_opened'
      and not exists (select 1 from public.payment_events c where c.kind = 'dispute_closed' and c.stripe_object_id = o.stripe_object_id);
end;
$$;
revoke execute on function public.payment_reconciliation_report() from public, anon;
grant execute on function public.payment_reconciliation_report() to authenticated, service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 161 (0409)' as step, '0409 Release M1: failed payments' as what, not ((to_regclass('public.payment_events') is null)) as in_place
) as result order by step;
