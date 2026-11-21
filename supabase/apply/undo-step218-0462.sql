-- UNDO: step 218 (wave 3 calendar and requests). Only if step 218 must be taken back. Stops without changing anything once a visitor has paid through the public page
-- (those payment records are kept). Quiet hours already given to new clients stay theirs (they can change them in Settings). Last result: one row, all true.

begin;

do $$
begin
  if to_regclass('public.public_booking_holds') is not null
     and exists (select 1 from public.public_booking_holds where state in ('claimed', 'booked', 'refunded') or payment_intent_id is not null) then
    raise exception 'A visitor has paid through the public page: step 218 is not undone, so the payment records are kept.';
  end if;
end;
$$;

-- Charge on a late change goes back to exactly what it was.
do $unpatch$
declare
  v_def text := replace(pg_get_functiondef('public.resolve_late_change(uuid, boolean)'::regprocedure), E'\r\n', E'\n');
begin
  if position('public_booking_holds' in v_def) = 0 then
    return;
  end if;
  v_def := replace(v_def,
    E'      -- Wave 3 C7: paid online on the public page means already paid: Charge keeps that payment and takes no session.\n      v_take := case when exists (select 1 from public.public_booking_holds where booking_id = p_booking_id and state = ''booked'') then 0 else greatest(0, 1 - public.booking_taken(p_booking_id)) end;\n',
    E'      v_take := greatest(0, 1 - public.booking_taken(p_booking_id));\n');
  execute v_def;
end
$unpatch$;

drop table if exists public.public_booking_holds;
drop trigger if exists session_types_guard_pay_to_book on public.session_types;
drop function if exists public.guard_pay_to_book();
alter table public.session_types drop column if exists pay_to_book;

drop function if exists public.turn_off_calendar_feed();
drop function if exists public.new_calendar_feed_link();
drop table if exists public.coach_calendar_feeds;

drop trigger if exists group_memberships_default_new_client_quiet_hours on public.group_memberships;
drop function if exists public.default_new_client_quiet_hours();
alter table public.profiles drop column if exists quiet_hours_default_pending;

alter table public.booking_requests drop column if exists lapse_told_at;
alter table public.booking_requests drop column if exists lapse_warned_at;

commit;

-- Check: one row, all true.
select
  to_regclass('public.public_booking_holds') is null as payments_table_gone,
  to_regclass('public.coach_calendar_feeds') is null as calendar_links_gone,
  not exists (select 1 from pg_trigger where tgname = 'session_types_guard_pay_to_book') as pay_guard_gone,
  not exists (select 1 from pg_trigger where tgname = 'group_memberships_default_new_client_quiet_hours') as quiet_hours_trigger_gone,
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'booking_requests' and column_name in ('lapse_warned_at', 'lapse_told_at')) as lapse_columns_gone,
  position('public_booking_holds' in (select prosrc from pg_proc where oid = 'public.resolve_late_change(uuid, boolean)'::regprocedure)) = 0 as charge_back_as_it_was;
