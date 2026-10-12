-- Release AP, part 1: a parent-view link can only be made for a child (under 13) who is a client in a group the coach coaches, it expires, and the coach can only change its revoked date.
-- Before, the one policy on guardian_links only checked that the coach coaches the group written on the row: the athlete id could be ANYONE's, so any coach could mint a no-login link that publishes
-- that person's name and today's meals. Now:
--   * creating needs public.guardian_link_allowed(athlete, group): the caller coaches that group, the athlete is a client in it, and their date of birth makes them under 13 today in the COACH's
--     business time zone (profiles.timezone; New York when none is set, the same default the app uses), the same under-13 line the app uses.
--   * every link has expires_at (90 days from creation; the creator cannot ask for longer). Links that are live today get 90 days from now.
--   * a coach can read, revoke and delete links of their groups, and the ONLY column they can change is revoked_at.
-- Existing rows are not deleted or edited beyond giving live links an expiry. The public page re-checks all of this on every visit (app code).
-- Release AP, part 2: three helper functions for the training-partner rules are no longer callable from the browser (the policies only call training_partner_is_restricted, which stays; it runs as
-- its owner, so its nested calls keep working).

alter table public.guardian_links add column if not exists expires_at timestamptz;
update public.guardian_links set expires_at = now() + interval '90 days' where expires_at is null and revoked_at is null;
alter table public.guardian_links alter column expires_at set default (now() + interval '90 days');

create or replace function public.guardian_link_allowed(p_athlete_id uuid, p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_group_coach(p_group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = p_group_id and gm.profile_id = p_athlete_id and gm.role = 'athlete'
    )
    and exists (
      select 1 from public.client_intake ci
      where ci.athlete_id = p_athlete_id
        and ci.date_of_birth is not null
        and ci.date_of_birth > (
          (now() at time zone coalesce(
            (select p.timezone from public.profiles p, pg_timezone_names z where p.id = (select auth.uid()) and z.name = p.timezone),
            'America/New_York'
          ))::date - interval '13 years'
        )::date
    );
$$;
revoke execute on function public.guardian_link_allowed(uuid, uuid) from public, anon;
grant execute on function public.guardian_link_allowed(uuid, uuid) to authenticated, service_role;

drop policy if exists "guardian_links_coach_manage" on public.guardian_links;
create policy "guardian_links_coach_select" on public.guardian_links for select
  to authenticated using (public.is_group_coach(group_id));
create policy "guardian_links_coach_insert" on public.guardian_links for insert
  to authenticated with check (
    created_by = (select auth.uid())
    and public.guardian_link_allowed(athlete_id, group_id)
    and expires_at <= now() + interval '91 days'
  );
create policy "guardian_links_coach_update" on public.guardian_links for update
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
create policy "guardian_links_coach_delete" on public.guardian_links for delete
  to authenticated using (public.is_group_coach(group_id));

-- The only thing a coach can change on a link is when it was revoked.
revoke update on public.guardian_links from authenticated;
grant update (revoked_at) on public.guardian_links to authenticated;

revoke execute on function public.training_partner_is_minor(uuid) from public, anon, authenticated;
revoke execute on function public.training_partner_intake_incomplete(uuid) from public, anon, authenticated;
revoke execute on function public.training_partner_org_restricted(uuid) from public, anon, authenticated;
