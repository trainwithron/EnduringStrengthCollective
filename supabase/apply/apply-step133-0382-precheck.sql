-- STEP 133 (PRECHECK, run first, changes nothing): 0382 Minors and health closures: children are never shown to or matched with other members, parent-link secrets are made by the database and need verified consent, believable weigh-ins, images-only scan photos, bounded scan saves
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0382 is not already applied (the new helper is not there yet)',
      to_regprocedure('public.training_partner_is_protected(uuid)') is null),
    ('the tables and helpers it builds on exist',
      to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.guardian_links') is not null and to_regclass('public.body_scans') is not null and to_regclass('public.minor_consent') is not null and to_regprocedure('public.training_partner_is_minor(uuid)') is not null and to_regprocedure('public.training_partner_intake_incomplete(uuid)') is not null),
    ('no existing weigh-in is outside 20 to 1500 (so the new rule fits what is saved)',
      not exists (select 1 from public.body_weight_logs where weight < 20 or weight > 1500))
) as checks(check_name, ok);
