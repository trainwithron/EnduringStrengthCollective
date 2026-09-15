-- Ron's direct decision: cross-org training-partner matching is not
-- allowed for the Trojans org (a real middle-school weight room) — a
-- genuine safeguarding concern for minors being matched across
-- organizations with no real vetting. Scoped narrowly to the CROSS-org
-- pool only, per trojans_build_session_and_multiorg_fixes_sept14.md's
-- own recommendation to lead with within-team mechanics for a youth
-- population, not disable partner matching entirely: two athletes who
-- happen to share an org can still match each other even when that org
-- has this flag set — only pairing across two DIFFERENT organizations
-- is what gets blocked, and only when at least one side is restricted.
alter table public.organizations
  add column restrict_cross_org_matching boolean not null default false;

update public.organizations set restrict_cross_org_matching = true
  where id = 'a70b4d99-cf7e-46c6-9b66-3c53df7a91b3'; -- Trojans

-- True when the two athletes share at least one real (non-null)
-- organization via any of their group memberships — an athlete can
-- belong to more than one org, so this is "any org in common," not a
-- single canonical org lookup.
create or replace function public.training_partners_share_org(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.group_memberships gm_a
    join public.groups g_a on g_a.id = gm_a.group_id
    join public.group_memberships gm_b on gm_b.profile_id = b
    join public.groups g_b on g_b.id = gm_b.group_id
    where gm_a.profile_id = a
      and g_a.organization_id is not null
      and g_b.organization_id = g_a.organization_id
  );
$$;

-- True when ANY organization this athlete belongs to (via any group
-- membership) has the flag set — a genuinely mixed-membership athlete
-- (rare) is treated as restricted if even one of their orgs opted in,
-- the more conservative reading for a safeguarding rule.
create or replace function public.training_partner_org_restricted(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.group_memberships gm
    join public.groups g on g.id = gm.group_id
    join public.organizations o on o.id = g.organization_id
    where gm.profile_id = p_athlete_id and o.restrict_cross_org_matching = true
  );
$$;

drop policy "training_partner_profiles_select_visible" on public.training_partner_profiles;
create policy "training_partner_profiles_select_visible" on public.training_partner_profiles for select
  to authenticated using (
    visible = true
    and not public.training_partners_mutually_blocked(athlete_id, (select auth.uid()))
    and (
      public.training_partners_share_org(athlete_id, (select auth.uid()))
      or (
        not public.training_partner_org_restricted(athlete_id)
        and not public.training_partner_org_restricted((select auth.uid()))
      )
    )
  );

-- Defense in depth: the same rule on the write path, so a direct insert
-- bypassing the browse UI can't reach someone the select policy would
-- never have shown in the first place.
drop policy "training_partner_requests_insert_own" on public.training_partner_requests;
create policy "training_partner_requests_insert_own" on public.training_partner_requests for insert
  to authenticated with check (
    from_athlete_id = (select auth.uid())
    and not public.training_partners_mutually_blocked(to_athlete_id, (select auth.uid()))
    and (
      public.training_partners_share_org(to_athlete_id, (select auth.uid()))
      or (
        not public.training_partner_org_restricted(to_athlete_id)
        and not public.training_partner_org_restricted((select auth.uid()))
      )
    )
  );
