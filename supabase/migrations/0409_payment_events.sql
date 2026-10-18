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
  -- a refund: Stripe's own id of this refund (one row per refund)
  refund_id text,
  -- when the coach was told (empty: not yet, so a redelivery tells them once)
  notified_at timestamptz,
  detail text,
  created_at timestamptz not null default now()
);
create unique index if not exists payment_events_refund_idx on public.payment_events (refund_id) where refund_id is not null;
create index if not exists payment_events_group_idx on public.payment_events (group_id, created_at desc);
create index if not exists payment_events_object_idx on public.payment_events (stripe_object_id) where stripe_object_id is not null;
create index if not exists payment_events_subscription_idx on public.payment_events (subscription_id) where subscription_id is not null;
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;
grant select on public.payment_events to authenticated;
-- The same three rules the other money tables have (credit_purchases, membership_subscriptions):
--   1. the client's own rows, a group's coaches, and the coach's own plan (no group). A coach who has left the group no longer reads its events.
drop policy if exists "payment_events_select_coach_or_own" on public.payment_events;
drop policy if exists "payment_events_select_own_or_coach" on public.payment_events;
create policy "payment_events_select_own_or_coach" on public.payment_events for select to authenticated
  using (
    athlete_id = (select auth.uid())
    or (group_id is not null and public.is_group_coach(group_id))
    or (group_id is null and coach_id = (select auth.uid()))
  );
--   2. the owner or an admin of the organization (the Business page of an owner or admin counts the whole organization), but never a client who keeps their records private from the organization.
drop policy if exists "payment_events_select_org_owner" on public.payment_events;
create policy "payment_events_select_org_owner" on public.payment_events for select to authenticated
  using (group_id is not null and public.is_org_admin_of_group(group_id) and (athlete_id is null or not public.is_client_private_from_org(group_id, athlete_id)));
--   3. only the organization the person has open (a coach in two organizations reads one at a time); rows with no group (the coach's own plan) are not part of any organization's wall.
do $wall$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_events' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.payment_events as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$wall$;

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
-- "Past due for more than 7 days" is counted from the FIRST failed attempt of the most recent failed invoice recorded for the subscription (the subscription row itself is rewritten on every update, so its own date says nothing; a
-- subscription that failed, recovered and failed again counts from the new failure). A subscription that went past due before failed payments were being recorded has no date to count from and is not counted; one that stays past due
-- across several invoices is counted from the latest invoice's first failure, so it can read younger than it is.
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
         'Subscriptions past due, whose latest failed invoice first failed more than 7 days ago'::text,
         count(*), (array_agg(s.stripe_subscription_id order by s.stripe_subscription_id))[1]
    from public.membership_subscriptions s
    join (select distinct on (e.subscription_id) e.subscription_id, e.stripe_object_id as invoice_id
            from public.payment_events e
           where e.kind = 'payment_failed' and e.subscription_id is not null
           order by e.subscription_id, e.created_at desc) latest on latest.subscription_id = s.stripe_subscription_id
    where s.status = 'past_due'
      and (select min(e2.created_at) from public.payment_events e2 where e2.kind = 'payment_failed' and e2.stripe_object_id = latest.invoice_id) < now() - interval '7 days';

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
