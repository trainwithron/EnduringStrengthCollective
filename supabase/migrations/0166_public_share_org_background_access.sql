-- Real regression found and fixed same-session: the public share page
-- (app/share/[postId]/page.tsx) started selecting groups.organization_id
-- (to look up the org's workout-card background setting) alongside the
-- already-anon-readable groups.name — but anon never had a column-level
-- SELECT grant on organization_id specifically, so the WHOLE groups row
-- silently came back null for anonymous viewers, breaking the group
-- name display too (not just the new background lookup). Row-level
-- access is already correctly scoped by the existing
-- groups_select_public_workout_share policy (0028) — this only grants
-- the missing column, nothing new at the row-access level.
grant select (organization_id) on public.groups to anon;

-- Post-workout share card v2 (post_workout_card_v1_bevel_and_animation.md)
-- needs the org's workout-card background setting for an anonymous
-- viewer — organizations had NO anon policy at all before this, so the
-- lookup silently returned nothing (safe, just meant custom backgrounds
-- never showed for anon viewers). Scoped the same narrow way as every
-- other public-share anon policy in this app: only orgs with a group
-- behind a genuine workout_summary post, never a blanket grant.
create policy "organizations_select_public_workout_share" on public.organizations for select
  to anon using (
    id in (
      select g.organization_id from public.groups g
      join public.posts p on p.group_id = g.id
      where p.post_type = 'workout_summary' and g.organization_id is not null
    )
  );
