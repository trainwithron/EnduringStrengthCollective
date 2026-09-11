-- In-app support inbox: a coach (paying platform customer) reaching the
-- platform operator for billing/support issues — not an athlete-to-coach
-- channel. Built as a real persisted thread rather than a mailto: link
-- or new outbound-email infra, since this app has never sent an email
-- of its own outside Supabase Auth's built-in invite flow, and a real
-- record on both sides is the actual point (per the Trainerize
-- billing-complaint precedent this was scoped from).

create table public.support_requests (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_requests_org_idx on public.support_requests(organization_id);
create index support_requests_status_idx on public.support_requests(status);

-- Flat thread, same shape as exercise_video_comments (0115) — no
-- reply-nesting needed for a support back-and-forth.
create table public.support_messages (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid not null references public.support_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index support_messages_request_idx on public.support_messages(request_id);

alter table public.support_requests enable row level security;
create policy "support_requests_select_own_org_or_admin" on public.support_requests for select
  to authenticated using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy "support_requests_insert_own" on public.support_requests for insert
  to authenticated with check (coach_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy "support_requests_update_own_or_admin" on public.support_requests for update
  to authenticated using (coach_id = (select auth.uid()) or public.is_platform_admin())
  with check (coach_id = (select auth.uid()) or public.is_platform_admin());

alter table public.support_messages enable row level security;
create policy "support_messages_select_participant" on public.support_messages for select
  to authenticated using (
    exists (
      select 1 from public.support_requests r
      where r.id = request_id and (public.is_org_member(r.organization_id) or public.is_platform_admin())
    )
  );
create policy "support_messages_insert_participant" on public.support_messages for insert
  to authenticated with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.support_requests r
      where r.id = request_id and (public.is_org_member(r.organization_id) or public.is_platform_admin())
    )
  );
