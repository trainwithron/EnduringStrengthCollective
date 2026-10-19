-- UNDO for step 174 (0422). Only if step 174 misbehaves, and only while the Release TC3 part B code is not live (the code needs these). Waiting requests are lost. The two notice kinds stay in the allowed list (harmless).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.decline_all_client_requests(uuid);
drop function if exists public.decline_client_request(uuid);
drop function if exists public.approve_client_request(uuid);
drop function if exists public.coach_client_request_count(uuid);
drop function if exists public.coach_client_requests(text, uuid);
drop function if exists public.submit_client_request(uuid, date);
drop function if exists public.client_request_org(uuid);
drop function if exists public.client_request_short_name(text);
drop table if exists public.client_request_blocks;
drop table if exists public.client_request_attempts;
drop table if exists public.client_requests;
alter table public.coach_booking_pages drop column if exists accepts_requests;
commit;
