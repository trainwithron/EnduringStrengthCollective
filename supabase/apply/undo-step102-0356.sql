-- UNDO for step 102 (0356). Only if step 102 misbehaves. Removes the quotes and the record of who was shown the card (their contents are lost).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.review_prompts_shown;
drop table if exists public.client_quotes;
drop function if exists public.client_quotes_refuse_minor();
commit;
