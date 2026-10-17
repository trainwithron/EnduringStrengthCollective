-- STEP 147: 0395 Release K1: push notifications that respect the person (quiet hours, private lock screen), a mark on each notice for the five-minute push job, and a payment notice type
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release K1 code is live. Adds three small settings on each person (quiet hours start and end, private lock screen), a pushed-at mark on notices (every existing notice is marked as already handled, so nothing old is sent), and one more notice type for payments. Safe to run before the code is live.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'pushed_at'))) then
    raise exception 'Step 147 (0395) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0395_push_quality.sql
-- ====================================================================================================

-- 0395: push notifications that respect the person. Adds:
--   profiles.quiet_hours_start / quiet_hours_end   an hour of the day (0 to 23) in the person's own time zone; no push is sent from the start hour up to the end hour (the in-app notice is still written). Both empty = no quiet hours.
--   profiles.generic_push_text                     when on, the lock screen shows "You have a new notification" instead of names and details.
--   notifications.pushed_at                        when the push for a notice made by the database (a booking request, a late change, a schedule request, a decision on a request) was sent. The new
--                                                  five-minute job sends those and marks them, so each is pushed once. Every existing notice is marked as already handled so nothing old is sent.
--   notification type 'payment_received'           a coach is told when a client pays.
-- Re-runnable.
alter table public.profiles add column if not exists quiet_hours_start smallint check (quiet_hours_start between 0 and 23);
alter table public.profiles add column if not exists quiet_hours_end smallint check (quiet_hours_end between 0 and 23);
alter table public.profiles add column if not exists generic_push_text boolean not null default false;
alter table public.notifications add column if not exists pushed_at timestamptz;
update public.notifications set pushed_at = coalesce(created_at, now()) where pushed_at is null;
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['payment_received']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

commit;
