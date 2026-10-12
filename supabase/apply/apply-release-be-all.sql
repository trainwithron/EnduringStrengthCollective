-- RELEASE BE (A COACH CAN ASK FOR NOTICE BEFORE A CLIENT PAUSES OR ENDS A SCHEDULE; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 99 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 99: Nothing changes for a coach who sets nothing (the default is no notice). A coach who sets days of notice on the Availability page: a client's pause, freeze or end request for a sooner date is refused with the earliest date in plain words, and the client sees the coach's words.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BE (a coach can ask for notice before a client pauses or ends a schedule; run BEFORE the code that goes with it is live), step 99: 0353 A coach can ask for notice before a client pauses, freezes or ends a weekly schedule, and can add their own wording
do $g99$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0353 is not already applied (no notice column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'schedule_change_notice_days')),
      ('the schedule-request function exists', to_regprocedure('public.request_schedule_change(uuid, text, date, date, text)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BE (a coach can ask for notice before a client pauses or ends a schedule; run BEFORE the code that goes with it is live), step 99 (0353) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g99$;

-- ====================================================================================================
-- migration 0353_schedule_change_notice.sql
-- ====================================================================================================

-- Release BE: a coach can ask for notice before a client pauses, freezes or ends a weekly schedule (days, default none) and can add their own words for the client to read. The schedule-request
-- function refuses a date sooner than today plus the notice, in plain words. Nothing changes for a coach who sets nothing.
alter table public.coach_booking_policies add column if not exists schedule_change_notice_days smallint not null default 0 check (schedule_change_notice_days between 0 and 60);
alter table public.coach_booking_policies add column if not exists schedule_change_notice_text text check (schedule_change_notice_text is null or char_length(schedule_change_notice_text) <= 200);

create or replace function public.request_schedule_change(p_series_id uuid, p_kind text, p_effective_on date, p_resume_on date default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.recurring_booking_series%rowtype;
  v_today date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_notice int;
  v_name text;
  v_to uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  select * into s from public.recurring_booking_series where id = p_series_id for update;
  -- The same answer for "not found" and "someone else's", so schedule ids cannot be probed.
  if s.id is null or s.athlete_id <> auth.uid() then
    raise exception 'not authorized';
  end if;
  if p_kind is null or p_kind not in ('pause', 'freeze', 'cancel') then
    raise exception 'choose pause, freeze or cancel';
  end if;
  if p_kind = 'cancel' then
    if s.status not in ('active', 'paused') then
      raise exception 'this schedule has already ended';
    end if;
  elsif s.status <> 'active' then
    raise exception 'this schedule is already paused or has ended';
  end if;

  v_today := public.schedule_local_today(s.timezone, s.coach_id);
  if p_effective_on is null or p_effective_on < v_today then
    raise exception 'choose today or a later date';
  end if;
  if p_effective_on > v_today + 180 then
    raise exception 'choose a date within the next six months';
  end if;
  -- The coach's own notice rule for pausing, freezing or ending a weekly schedule (days, default none). The earliest date is today plus the notice.
  v_notice := coalesce((select p.schedule_change_notice_days from public.coach_booking_policies p where p.coach_id = s.coach_id), 0);
  if v_notice > 0 and p_effective_on < v_today + v_notice then
    raise exception 'your coach asks for % days notice: the earliest date is %', v_notice, to_char(v_today + v_notice, 'Mon FMDD');
  end if;
  if p_kind = 'freeze' then
    if p_resume_on is null then
      raise exception 'choose the day you want to start again';
    end if;
    if p_resume_on <= p_effective_on then
      raise exception 'the day you start again must be after the freeze begins';
    end if;
    if p_resume_on > p_effective_on + 84 then
      raise exception 'a freeze can last up to 12 weeks';
    end if;
  elsif p_resume_on is not null then
    raise exception 'only a freeze has a day to start again';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'please keep your note under 500 characters';
  end if;

  -- Lock the client's row so two requests at the same moment cannot both pass the daily limit.
  perform 1 from public.profiles where id = s.athlete_id for update;
  if (select count(*) from public.schedule_requests r where r.athlete_id = s.athlete_id and r.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'you have sent a few requests today: message your coach';
  end if;

  begin
    insert into public.schedule_requests (series_id, athlete_id, coach_id, group_id, kind, effective_on, resume_on)
    values (s.id, s.athlete_id, s.coach_id, s.group_id, p_kind, p_effective_on, p_resume_on)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'you already have a request waiting for this schedule';
  end;
  if v_note is not null then
    insert into public.schedule_request_notes (request_id, note) values (v_id, v_note);
  end if;

  select full_name into v_name from public.profiles where id = s.athlete_id;
  for v_to in select * from public.schedule_request_recipients(s.group_id, s.coach_id) loop
    -- Fixed wording only: never the kind of request and never the note.
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_to, s.group_id, 'schedule_request', coalesce(nullif(btrim(v_name), ''), 'A client') || ' sent a schedule request.', '/dashboard');
  end loop;
  return v_id;
end;
$function$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 99 (0353)' as step, '0353 A coach can ask for notice before a client pauses' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'schedule_change_notice_days'))) as in_place
) as result order by step;
