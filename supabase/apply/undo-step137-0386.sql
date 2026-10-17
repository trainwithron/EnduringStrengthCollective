-- UNDO for step 137 (0386). Only if step 137 misbehaves. Removes the guard function (and its switch, step 140, if that was run) and the coach decision columns (decisions already written are lost with them).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists client_intake_guard_completion on public.client_intake;
drop function if exists public.client_intake_guard_completion();
alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_decision_check;
alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_note_length;
alter table public.athlete_injury_flag_acknowledgements drop column if exists decision;
alter table public.athlete_injury_flag_acknowledgements drop column if exists note;
commit;
