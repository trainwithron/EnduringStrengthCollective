-- Release BH: asking a happy client for a review, once and quietly. A client who has done 12 sessions (and is an adult) is shown ONE small card (never again, whatever they answer) with a box for a short
-- review and a box to tick if they agree the coach may share it publicly. A review without that tick stays private to the coach; a ticked one can be featured on the coach's page, but only when the coach
-- chooses to add it: nothing is published by the client.

create table if not exists public.client_quotes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 240),
  first_name text check (first_name is null or char_length(first_name) <= 30),
  -- the client's own tick: "I agree the coach may share this publicly". Without it the quote is never shown anywhere but to the coach.
  share_publicly boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'used', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists client_quotes_coach_idx on public.client_quotes (coach_id, status);
alter table public.client_quotes enable row level security;
revoke all on public.client_quotes from anon;
-- The client writes and sees only their own quote, and only to a coach of their own group; the coaches of that group read it and say what happens to it. A client cannot change a quote after sending it.
create policy "client_quotes_insert_own" on public.client_quotes for insert to authenticated
  with check (
    athlete_id = (select auth.uid()) and status = 'pending'
    and exists (select 1 from public.group_memberships a where a.group_id = client_quotes.group_id and a.profile_id = (select auth.uid()) and a.role = 'athlete')
    and exists (select 1 from public.group_memberships c where c.group_id = client_quotes.group_id and c.profile_id = client_quotes.coach_id and c.role = 'coach')
  );
create policy "client_quotes_select_own_or_coach" on public.client_quotes for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "client_quotes_update_coach" on public.client_quotes for update to authenticated
  using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
-- A coach says what happens to a quote (status) and can change nothing else: they cannot edit what a client wrote.
revoke update on public.client_quotes from authenticated;
grant update (status) on public.client_quotes to authenticated;

-- One row per client and group once the card has been shown, so it never comes back.
create table if not exists public.review_prompts_shown (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  shown_at timestamptz not null default now(),
  outcome text check (outcome is null or outcome in ('quote', 'not_now')),
  primary key (athlete_id, group_id)
);
alter table public.review_prompts_shown enable row level security;
revoke all on public.review_prompts_shown from anon;
create policy "review_prompts_shown_own" on public.review_prompts_shown for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()) and exists (select 1 from public.group_memberships a where a.group_id = review_prompts_shown.group_id and a.profile_id = (select auth.uid()) and a.role = 'athlete'));

-- Both tables carry the organization-wall rule (Release AZ) when that is installed.
do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null then
    create policy "org_wall_header" on public.client_quotes as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
    create policy "org_wall_header" on public.review_prompts_shown as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;
