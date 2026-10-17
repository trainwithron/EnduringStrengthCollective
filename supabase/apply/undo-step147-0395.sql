-- UNDO for step 147 (0395). Only if step 147 misbehaves. Run it only while the Release K1 code is not live (Settings, the push sender and the push job use the columns). Quiet hours people set are lost.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop index if exists public.notifications_unpushed_idx;
alter table public.notifications drop column if exists pushed_at;
alter table public.profiles drop column if exists generic_push_text;
alter table public.profiles drop column if exists quiet_hours_end;
alter table public.profiles drop column if exists quiet_hours_start;
-- the extra notification type is left in the list (removing it could break rows that use it)
commit;
