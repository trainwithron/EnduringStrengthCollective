-- UNDO for step 23 (0281). Only if set-aside clients or the new triggers misbehave after step 23. Removes the three triggers, the two functions, the coach-only set-aside table and its event log. Anyone currently set aside simply shows as active again (nothing else about them changes).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists direct_messages_resurface_client on public.direct_messages;
drop trigger if exists bookings_resurface_client on public.bookings;
drop trigger if exists workout_logs_resurface_client on public.workout_logs;
drop function if exists public.resurface_inactive_client();
drop function if exists public.set_client_inactive(uuid, uuid, boolean, text);
drop table if exists public.client_inactive;
drop table if exists public.client_inactive_events;
commit;
