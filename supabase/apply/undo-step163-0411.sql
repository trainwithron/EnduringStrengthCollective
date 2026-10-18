-- UNDO for step 163 (0411). Only if step 163 misbehaves. Run it only while the Release CM1 code is not live. Blocks and reports are forgotten.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.handle_content_report(uuid);
drop function if exists public.report_content(uuid, uuid, text);
drop table if exists public.content_reports;
drop table if exists public.user_blocks;
-- the extra notification kind is left in the list (removing it could break rows that use it)
commit;
