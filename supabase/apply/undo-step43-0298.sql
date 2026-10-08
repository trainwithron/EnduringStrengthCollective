-- UNDO for step 43 (0298). Only if Read misbehaves after step 43. Removes the client switches and note records (every client is back to the default, Read on), the coach's day-by-day passages, the coach's switch for all their clients, and the one function. The passages are in the app and are not touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.read_track_for_me(uuid, date);
drop table if exists public.read_passage_overrides;
drop table if exists public.read_settings;
alter table public.coach_preferences drop column if exists faith_track_default;
commit;
