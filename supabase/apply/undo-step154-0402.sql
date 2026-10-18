-- UNDO for step 154 (0402). Only if step 154 misbehaves. Run it only while the Release V1 code is not live. Removes every request and every signed permission (the signed words and fingerprints go with them).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.guardian_consent_state(uuid);
drop table if exists public.guardian_consents;
commit;
