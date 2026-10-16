-- STEP 135 (PRECHECK, run first, changes nothing): 0384 Privacy closures: shared lists changed only by their owner, private clients stay private from organization admins, ten more client tables refuse a row about a non-member, progress photos in the owner's folder, an audit trail for access-changing rows
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0384 is not already applied (the private-space helper is not there yet)',
      to_regprocedure('public.is_group_private_from_org(uuid)') is null),
    ('the tables and helpers it builds on exist',
      to_regclass('public.builtin_ingredient_usda_mappings') is not null and to_regclass('public.exercise_biomech_tags') is not null and to_regclass('public.client_inactive') is not null and to_regclass('public.schedule_requests') is not null and to_regclass('public.progress_photos') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and to_regprocedure('public.enforce_athlete_in_group()') is not null and to_regprocedure('public.audit_watch()') is not null),
    ('every existing progress photo already sits in its owner''s folder (so the new rule fits what is saved)',
      not exists (select 1 from public.progress_photos where storage_path not like athlete_id::text || '/%'))
) as checks(check_name, ok);
