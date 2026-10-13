-- Release BS: smaller goals under a client's goal. Either the client or their coach adds one (a title and an optional date: "Deadlift 315 by Nov 30"); the OTHER side agrees or says not now; once agreed, either side can mark it done.
-- Nothing here changes a program or a nutrition target. The people involved read them (the client, and the coaches of the group); adding is limited to the client for themselves or a coach for a client of their
-- group; changing the state (agree, not now, done) is done only by the server, which checks who is asking, so there is no update or delete right for signed-in people. Like every table of group content it carries
-- the organization-wall rule when that is installed.
create table public.client_sub_goals (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  goal_id uuid references public.client_goals(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  target_date date,
  proposed_by uuid not null references public.profiles(id),
  status text not null default 'proposed' check (status in ('proposed', 'agreed', 'declined', 'done')),
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index client_sub_goals_athlete_idx on public.client_sub_goals (athlete_id, group_id);

alter table public.client_sub_goals enable row level security;
revoke all on public.client_sub_goals from anon;
revoke update, delete, truncate on public.client_sub_goals from authenticated;

create policy "client_sub_goals_read" on public.client_sub_goals for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "client_sub_goals_add" on public.client_sub_goals for insert to authenticated
  with check (
    proposed_by = (select auth.uid())
    and status = 'proposed'
    and responded_by is null
    and (
      athlete_id = (select auth.uid())
      or (public.is_group_coach(group_id) and exists (select 1 from public.group_memberships gm where gm.group_id = client_sub_goals.group_id and gm.profile_id = client_sub_goals.athlete_id and gm.role = 'athlete'))
    )
    and exists (select 1 from public.group_memberships gm2 where gm2.group_id = client_sub_goals.group_id and gm2.profile_id = client_sub_goals.athlete_id)
  );

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null then
    create policy "org_wall_header" on public.client_sub_goals as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;
