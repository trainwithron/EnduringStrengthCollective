-- Follow-up review of the Oura wearables integration merged this session:
-- its coach-visibility cascade (own -> group coach -> org owner/admin ->
-- platform admin) never checked group_memberships.private_from_org — the
-- opt-out a coach can set per client to keep that client's data private
-- from the org hierarchy above them (migration 0088). That flag existed
-- specifically so a coach's explicit privacy choice actually holds; a new
-- data source landing outside it is a real regression against it, not a
-- separate concern.
--
-- wearable_connections/wearable_daily_metrics carry only a profile_id, no
-- group_id — an athlete can be in more than one group, so "private" here
-- means private in ANY relationship, the conservative reading: if a
-- coach has marked this athlete private in even one shared group, hide
-- their wearable data from the org-admin/platform-admin cascade
-- entirely, rather than trying to attribute one biometric data stream to
-- a specific group.
create or replace function public.is_wearable_subject_private_from_org(_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships
    where profile_id = _profile_id and private_from_org = true
  );
$$;

drop policy if exists "wearable_connections_select_own_or_coach" on public.wearable_connections;
create policy "wearable_connections_select_own_or_coach"
  on public.wearable_connections for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.group_memberships gm_self
      join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
      where gm_self.profile_id = auth.uid()
        and gm_self.role = 'coach'
        and gm_target.profile_id = wearable_connections.profile_id
    )
    or (
      not public.is_wearable_subject_private_from_org(wearable_connections.profile_id)
      and (
        exists (
          select 1 from public.group_memberships gm_target
          join public.groups g on g.id = gm_target.group_id
          join public.organization_memberships om on om.organization_id = g.organization_id
          where gm_target.profile_id = wearable_connections.profile_id
            and om.profile_id = auth.uid()
            and om.role in ('owner', 'admin')
        )
        or public.is_platform_admin()
      )
    )
  );

drop policy if exists "wearable_daily_metrics_select_own_or_coach" on public.wearable_daily_metrics;
create policy "wearable_daily_metrics_select_own_or_coach"
  on public.wearable_daily_metrics for select
  to authenticated
  using (
    exists (
      select 1 from public.wearable_connections c
      where c.id = wearable_daily_metrics.connection_id
        and (
          c.profile_id = auth.uid()
          or exists (
            select 1 from public.group_memberships gm_self
            join public.group_memberships gm_target on gm_target.group_id = gm_self.group_id
            where gm_self.profile_id = auth.uid()
              and gm_self.role = 'coach'
              and gm_target.profile_id = c.profile_id
          )
          or (
            not public.is_wearable_subject_private_from_org(c.profile_id)
            and (
              exists (
                select 1 from public.group_memberships gm_target
                join public.groups g on g.id = gm_target.group_id
                join public.organization_memberships om on om.organization_id = g.organization_id
                where gm_target.profile_id = c.profile_id
                  and om.profile_id = auth.uid()
                  and om.role in ('owner', 'admin')
              )
              or public.is_platform_admin()
            )
          )
        )
    )
  );
