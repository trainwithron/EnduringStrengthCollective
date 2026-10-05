-- Records of what people agreed to: the beta notice, terms, privacy policy and the liability waiver, with the version, the time,
-- the address and device it came from, and (for the waiver) the exact text that was shown. Rows are only ever added.
--
-- Also stops a client changing their own signed waiver: client_intake used to let the athlete rewrite their row at any time
-- (one policy for everything). They can still create it and finish filling it in, but once it is completed it is locked.
-- The signed text itself lives in legal_acceptances, which has no update or delete policy.

create table if not exists public.legal_acceptances (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  document text not null check (document in ('beta_notice', 'terms', 'privacy', 'refunds', 'waiver')),
  version text not null,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text,
  text_snapshot text,
  unique (profile_id, document, version)
);
create index if not exists legal_acceptances_profile_idx on public.legal_acceptances (profile_id);

alter table public.legal_acceptances enable row level security;
-- A person reads their own acceptances. Nobody writes from the browser: rows are added by the server with the service role.
create policy "legal_acceptances_select_own" on public.legal_acceptances for select
  to authenticated
  using (profile_id = (select auth.uid()));
-- A coach can see the waiver acceptance of their own clients.
create policy "legal_acceptances_select_coach_waiver" on public.legal_acceptances for select
  to authenticated
  using (
    document = 'waiver'
    and exists (
      select 1 from public.client_intake ci
      where ci.athlete_id = legal_acceptances.profile_id and public.is_group_coach(ci.group_id)
    )
  );

-- client_intake: create and complete it, but not rewrite it afterwards, and never delete it.
drop policy if exists "client_intake_write_own" on public.client_intake;
create policy "client_intake_insert_own" on public.client_intake for insert
  to authenticated with check (athlete_id = (select auth.uid()));
create policy "client_intake_update_own_until_completed" on public.client_intake for update
  to authenticated
  using (athlete_id = (select auth.uid()) and completed_at is null)
  with check (athlete_id = (select auth.uid()));
