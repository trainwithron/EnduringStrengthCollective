-- Bulk announcement (coach -> many clients, one merged DM each).
-- Outbound messages go to real people under the coach's name and can't
-- be unsent, so a send is recorded as a batch with an idempotency key
-- the client generates when the confirm step opens: a double-click or
-- retry with the same key can never send twice. Same insert-first,
-- unique-key shape as sms_log (0190) and credit_purchases.stripe_event_id.
create table public.broadcast_batches (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  template text not null,
  recipient_count int not null check (recipient_count > 0),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  unique (coach_id, idempotency_key)
);
create index broadcast_batches_coach_id_idx on public.broadcast_batches(coach_id);

alter table public.broadcast_batches enable row level security;
create policy "broadcast_batches_select_own" on public.broadcast_batches for select
  to authenticated using (coach_id = (select auth.uid()));
create policy "broadcast_batches_insert_own" on public.broadcast_batches for insert
  to authenticated with check (coach_id = (select auth.uid()));
create policy "broadcast_batches_update_own" on public.broadcast_batches for update
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

-- Links each delivered DM back to its batch (audit trail of exactly
-- what went to whom). Nullable: every ordinary DM stays unaffected.
alter table public.direct_messages
  add column broadcast_batch_id uuid references public.broadcast_batches(id) on delete set null;
