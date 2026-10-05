-- A coach logging an in-person session for a client no longer spends a
-- session credit automatically. Until now complete_workout_session()
-- deducted the session type's credit_cost whenever logged_by_coach was
-- true. Spending a credit is now an explicit, default-OFF choice the coach
-- makes when starting the session (athlete_sessions.deduct_session_credit);
-- anything else (manual +/- on the client's profile, bookings, purchases,
-- expiry) is unchanged.
--
-- The function body is large and unrelated to this change, so rather than
-- re-pasting it, the live definition is read back and ONE condition is
-- rewritten (failing loudly if the expected text isn't found).

alter table public.athlete_sessions
  add column if not exists deduct_session_credit boolean not null default false;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  where p.proname = 'complete_workout_session'
    and p.pronamespace = 'public'::regnamespace;

  v_def := replace(
    v_def,
    'if v_session.logged_by_coach and v_credit_cost > 0 then',
    'if v_session.logged_by_coach and v_session.deduct_session_credit and v_credit_cost > 0 then'
  );

  if v_def not like '%v_session.deduct_session_credit%' then
    raise exception 'complete_workout_session: credit condition not found';
  end if;

  execute v_def;
end $$;
