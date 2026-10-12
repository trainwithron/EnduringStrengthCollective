-- STEP 91 (PRECHECK, run first, changes nothing): 0345 The organization walls: a person can only see names of people they share a group with (or, for an owner or admin, everyone in their organization); a platform administrator can no longer read client content; who has which tag is limited to the owner, admins and that client's coach
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0345 is not already applied (the open profiles rule is still there)',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_authenticated')),
    ('the helpers the new rules use exist',
      to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.is_workout_visible_to_athlete(uuid)') is not null),
    ('the tables the new rules read exist',
      to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.session_credits') is not null and to_regclass('public.client_tag_assignments') is not null and to_regclass('public.wearable_connections') is not null)
) as checks(check_name, ok);
