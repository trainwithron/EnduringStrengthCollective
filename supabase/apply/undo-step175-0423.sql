-- UNDO for step 175 (0423). Only if step 175 misbehaves, and only while the Release NS code is not live (the code reads the column). Every notice is delivered again; the switches people set are lost.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists notifications_respect_switch on public.notifications;
drop function if exists public.notifications_respect_switch();
drop function if exists public.notice_kind_of(text);
alter table public.profiles drop column if exists notices_off;
commit;
