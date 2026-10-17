-- STEP 137: 0386 A client's health form and waiver are finished by the server, never by the browser; a coach's decision on a flagged screening is kept
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. From now on the health form and waiver are finished only by the app's server: a signed-in person's browser can no longer mark its own form complete or write the answers and signed name (it can still change its date of birth). A coach can record a decision (cleared, train with changes, hold) and a note when acknowledging a flagged health screening.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.client_intake_guard_completion()') is null)) then
    raise exception 'Step 137 (0386) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0386_intake_server_completes.sql
-- ====================================================================================================

-- Release CM: a client's health form and waiver are finished by the server, never by the browser.
--   * client_intake used to let the signed-in client write ANY of its columns (insert policy: own row; update policy: own row until completed), so a script could mark its own intake complete with any time and any
--     answers. A guard now refuses, for a signed-in person, every change to the completion columns (par_q_answers, waiver_signed_name, waiver_accepted, completed_at): the form is finished by
--     /api/intake/submit, which writes with the service role. The date of birth (and the group a row belongs to) are still written by the client as before.
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

drop trigger if exists client_intake_guard_completion on public.client_intake;
create trigger client_intake_guard_completion
  before insert or update on public.client_intake
  for each row execute function public.client_intake_guard_completion();

alter table public.athlete_injury_flag_acknowledgements add column if not exists decision text;
alter table public.athlete_injury_flag_acknowledgements add column if not exists note text;
alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_decision_check;
alter table public.athlete_injury_flag_acknowledgements add constraint athlete_injury_flag_ack_decision_check
  check (decision is null or decision in ('cleared', 'modified', 'hold')) not valid;
alter table public.athlete_injury_flag_acknowledgements drop constraint if exists athlete_injury_flag_ack_note_length;
alter table public.athlete_injury_flag_acknowledgements add constraint athlete_injury_flag_ack_note_length
  check (note is null or char_length(note) <= 500) not valid;

commit;
