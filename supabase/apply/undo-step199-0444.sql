-- UNDO step 199 (the coach's parent checkbox): teens go back to needing the emailed signature. Restore the two functions from migrations 0402 and 0415 first, then drop the table.
-- Run supabase/migrations/0415_minor_may_write.sql's minor_may_write and 0402_guardian_consent.sql's guardian_consent_state again, then:
drop function if exists public.set_guardian_confirmed(uuid, boolean);
drop table if exists public.guardian_coach_confirmations;
