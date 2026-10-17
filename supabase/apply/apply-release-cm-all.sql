-- RELEASE CM (THE GUARD FUNCTION AND A COACH'S DECISION ON A FLAGGED SCREENING; ADDS ONLY, SAFE TO RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 137 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 137: Nothing changes on screen, and the old health form keeps working: this step only adds the guard function (not yet switched on, see step 140) and the places where a coach's decision on a flagged health screening is kept (cleared, train with changes, hold, and a note). It is safe to run before the new code is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CM (the guard function and a coach's decision on a flagged screening; adds only, safe to run BEFORE the code that goes with it is live), step 137: 0386 A client's health form and waiver are finished by the server, never by the browser; a coach's decision on a flagged screening is kept
do $g137$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0386 is not already applied (the guard function is not there yet)', to_regprocedure('public.client_intake_guard_completion()') is null),
      ('the tables it builds on exist', to_regclass('public.client_intake') is not null and to_regclass('public.athlete_injury_flag_acknowledgements') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CM (the guard function and a coach''s decision on a flagged screening; adds only, safe to run BEFORE the code that goes with it is live), step 137 (0386) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g137$;

-- ====================================================================================================
-- migration 0386_intake_server_completes.sql
-- ====================================================================================================

-- Release CM: a client's health form and waiver are finished by the server, never by the browser.
--   * client_intake used to let the signed-in client write ANY of its columns (insert policy: own row; update policy: own row until completed), so a script could mark its own intake complete with any time and any
--     answers. The guard function that refuses, for a signed-in person, every change to the completion columns (par_q_answers, waiver_signed_name, waiver_accepted, completed_at) is made here; the form is
--     finished by /api/intake/submit, which writes with the service role. The date of birth (and the group a row belongs to) are still written by the client as before.
--     THE GUARD IS NOT SWITCHED ON HERE. This step only adds things (the function and the coach-decision columns), so it is safe to run BEFORE the new code is live: the old form keeps working. The trigger that
--     switches the guard on is migration 0388 (Release CP), which is run AFTER the new code is live.
--   * A coach's decision on a flagged health screening is kept with the acknowledgement: cleared, train with changes, or hold, with an optional note.

create or replace function public.client_intake_guard_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The server (service role), migrations and the database owner have no signed-in person: they pass.
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.par_q_answers := '[]'::jsonb;
    new.waiver_signed_name := null;
    new.waiver_accepted := false;
    new.completed_at := null;
    return new;
  end if;
  if new.par_q_answers is distinct from old.par_q_answers
     or new.waiver_signed_name is distinct from old.waiver_signed_name
     or new.waiver_accepted is distinct from old.waiver_accepted
     or new.completed_at is distinct from old.completed_at then
    raise exception 'Your health form is saved by the server. Use the form to finish it.';
  end if;
  return new;
end;
$$;
revoke all on function public.client_intake_guard_completion() from public, anon, authenticated;

alter table public.athlete_injury_flag_acknowledgements add column if not exists decision text;
alter table public.athlete_injury_flag_acknowledgements add column if not exists note text;
alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_decision_check;
alter table public.athlete_injury_flag_acknowledgements add constraint athlete_injury_flag_ack_decision_check
  check (decision is null or decision in ('cleared', 'modified', 'hold')) not valid;
alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_note_length;
alter table public.athlete_injury_flag_acknowledgements add constraint athlete_injury_flag_ack_note_length
  check (note is null or char_length(note) <= 500) not valid;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 137 (0386)' as step, '0386 A client''s health form and waiver are finished by the server' as what, not ((to_regprocedure('public.client_intake_guard_completion()') is null)) as in_place
) as result order by step;
