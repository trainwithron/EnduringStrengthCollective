-- READ-ONLY. Lists the clients step 138 would require a health form and waiver of, so Ron can read the names first. Changes nothing.
select p.full_name, (select u.email from auth.users u where u.id = p.id) as email, (select string_agg(g.name, ', ') from public.group_memberships gm join public.groups g on g.id = gm.group_id where gm.profile_id = p.id and gm.role = 'athlete') as groups,
  exists (select 1 from public.client_intake ci where ci.athlete_id = p.id) as has_started_form
from public.profiles p
where p.intake_required is not true
  and exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'athlete')
  and not exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'coach')
  and not exists (select 1 from public.client_intake ci where ci.athlete_id = p.id and ci.completed_at is not null)
  and not coalesce(p.is_platform_admin, false)
  and not exists (select 1 from public.group_memberships gx join public.groups gg on gg.id = gx.group_id where gx.profile_id = p.id and gg.organization_id = '50000000-0000-0000-0000-000000000001')
order by p.full_name;
