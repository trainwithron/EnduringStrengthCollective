-- UNDO for step 165 (0413). Only if step 165 misbehaves, and only while the Release T2 code is not live. If tokens were already scrambled, do not undo: Garmin updates could no longer be matched to a person.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop index if exists public.wearable_oauth_tokens_access_token_hash_idx;
alter table public.wearable_oauth_tokens drop column if exists access_token_hash;
commit;
