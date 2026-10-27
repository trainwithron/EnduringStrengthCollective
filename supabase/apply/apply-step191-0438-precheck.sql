-- STEP 191 (PRECHECK, run first, changes nothing): 0438 A coach's Instagram handle moves to the coach's own settings (coach_profiles), so every coach can set it, with or without a public page
--
-- !! This adds coach_profiles.instagram_handle (none until a coach sets it; 1 to 30 letters, digits, "." and "_", no @), copies any handle saved on a public page row across, and drops coach_booking_pages.instagram_handle (added by step 190) so there is one place. Until the app update that goes with it is deployed, share pictures carry no handle and the handle box under Booking page / Availability is hidden: deploy it right after.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0438 is not already applied (coach_profiles has no instagram_handle yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_profiles' and column_name = 'instagram_handle')),
    ('step 190 is in: coach_booking_pages has instagram_handle',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle')),
    ('no handle is saved on any page row yet (nothing to copy)',
      not exists (select 1 from public.coach_booking_pages b where to_jsonb(b) ->> 'instagram_handle' is not null)),
    ('coach_profiles is keyed by coach_id',
      exists (select 1 from pg_constraint where conrelid = 'public.coach_profiles'::regclass and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (coach_id)')),
    ('coach_profiles has exactly its two rules (0196): read own or a client''s coach, change own',
      (select count(*) from pg_policies where schemaname = 'public' and tablename = 'coach_profiles') = 2 and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_profiles' and policyname = 'coach_profiles_select_own_or_client') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_profiles' and policyname = 'coach_profiles_write_own'))
) as checks(check_name, ok);
