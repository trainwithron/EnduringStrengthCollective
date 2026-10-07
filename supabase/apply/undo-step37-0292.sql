-- UNDO for step 37 (0292). Only if the new column causes trouble. Removes the column (the recorded classes are lost).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.ai_usage_log drop constraint if exists ai_usage_log_error_class_len;
alter table public.ai_usage_log drop column if exists error_class;
commit;
