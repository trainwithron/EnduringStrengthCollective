-- UNDO for step 184 (0432). Only if step 184 misbehaves, and only while the app update that goes with it is NOT live (its screens ask client_slot_reasons). The three booking functions get their hours check back exactly as it was and the four functions go. The five columns stay (nothing reads them without the functions).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $undo$
declare
  v_def text;
  r record;
begin
  for r in select * from (values
    ('public.book_session(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure, '(public.coach_time_is_open(p_coach_id, p_start_at, p_end_at) and public.assert_client_slot_offered(p_coach_id, p_start_at, p_end_at, null::uuid, true))', 'public.coach_time_is_open(p_coach_id, p_start_at, p_end_at)'),
    ('public.reschedule_booking(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure, '(public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at) and public.assert_client_slot_offered(v_coach_id, p_new_start_at, p_new_end_at, p_booking_id, true))', 'public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at)'),
    ('public.check_booking_request_slot(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure, '(public.coach_time_is_open(p_coach_id, p_start, p_end) and public.assert_client_slot_offered(p_coach_id, p_start, p_end, p_ignore_booking_id, false))', 'public.coach_time_is_open(p_coach_id, p_start, p_end)')
  ) as t(fn, new_text, old_text) loop
    v_def := pg_get_functiondef(r.fn);
    if position(r.new_text in v_def) > 0 then
      execute replace(v_def, r.new_text, r.old_text);
    end if;
  end loop;
end $undo$;
drop function if exists public.my_session_count(timestamptz, timestamptz);
drop function if exists public.client_slot_reasons(uuid, timestamptz[], timestamptz[], uuid);
drop function if exists public.assert_client_slot_offered(uuid, timestamptz, timestamptz, uuid, boolean);
drop function if exists public.client_slot_reason(uuid, timestamptz, timestamptz, uuid, boolean);
drop function if exists public.coach_session_count(uuid, timestamptz, timestamptz, uuid);
commit;
