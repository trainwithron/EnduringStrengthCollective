-- STEP 26 (PRECHECK, run first, changes nothing): move the group The Home Team from Ron's own organization (Enduring Strength Co.) into Coast2Coast Fitness, keeping its programs, history and Ron's coach access
--
-- !! Platform-owner change, one group only. Run the precheck first (every row true). Nothing is deleted. The group keeps its two programs and everything attached to it; only which organization it belongs to changes.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the group The Home Team exists',
      exists (select 1 from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630')),
    ('Coast2Coast Fitness exists',
      exists (select 1 from public.organizations where id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48')),
    ('step 26 is not already applied (The Home Team is still in Enduring Strength Co.)',
      exists (select 1 from public.groups where id = '060017b5-e613-4204-a101-c6a14c3a9630' and organization_id = 'b7318b19-a17e-4412-88f1-51d68fcf026f')),
    ('The Home Team has no clients, only coaches (so no client data is tied to the old organization)',
      not exists (select 1 from public.group_memberships where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and role = 'athlete')),
    ('every coach of The Home Team already owns or administers Coast2Coast Fitness',
      not exists (select 1 from public.group_memberships gm where gm.group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and gm.role = 'coach' and not exists (select 1 from public.organization_memberships om where om.organization_id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48' and om.profile_id = gm.profile_id and om.role in ('owner', 'admin'))))
) as checks(check_name, ok);
