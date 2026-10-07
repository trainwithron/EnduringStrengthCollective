-- UNDO for step 42 (0297). Only if schedule requests misbehave after step 42. Removes the two request tables (every request and every private note is lost), their audit trigger, the functions, and the freeze columns on the schedule (a schedule that is frozen stays paused: restart it from the client's profile), deletes the three new kinds of notification and puts the notification types back to the list the database had without them (read from the live list, so another release's types are kept). An expiry hold that a freeze already set stays as it is (a coach can clear it on the client's profile). Nothing else is touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $undo$ declare v_def text; v_have text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; delete from public.notifications where type in ('schedule_request', 'schedule_applied', 'schedule_resumed'); select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m; v_have := array(select t from unnest(v_have) as t where t not in ('schedule_request', 'schedule_applied', 'schedule_resumed')); alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_have) as t)); end $undo$;
drop trigger if exists schedule_requests_audit on public.schedule_requests;
drop table if exists public.schedule_request_notes;
drop table if exists public.schedule_requests;
drop function if exists public.request_schedule_change(uuid, text, date, date, text);
drop function if exists public.withdraw_schedule_request(uuid);
drop function if exists public.dismiss_schedule_request(uuid);
drop function if exists public.claim_schedule_request(uuid, boolean);
drop function if exists public.claim_due_schedule_requests(integer);
drop function if exists public.finish_schedule_request(uuid, boolean, boolean, boolean, text);
drop function if exists public.end_schedule_freeze(uuid, date);
drop function if exists public.claim_due_freeze_resumes(integer);
drop function if exists public.fail_freeze_resume(uuid, text);
drop function if exists public.note_schedule_resumed(uuid, integer, integer);
drop function if exists public.extend_expiry_for_freeze(uuid, uuid, uuid, integer, text);
drop function if exists public.schedule_request_recipients(uuid, uuid);
drop function if exists public.schedule_local_today(text, uuid);
alter table public.recurring_booking_series drop constraint if exists recurring_booking_series_frozen_ok;
alter table public.recurring_booking_series drop column if exists frozen_from, drop column if exists frozen_until, drop column if exists resume_claimed_at, drop column if exists resume_attempts, drop column if exists resume_error;
commit;
