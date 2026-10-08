-- RELEASE O (RECALCULATION NOTICE): ONE paste. Steps 51 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 51: Nothing changes until the code of the same release is live. After that, when a coach applies a new target the client gets a bell notice and a card asking if they are happy with their meal plan; the coach sees the answer in Preferences.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release O (recalculation notice), step 51: 0306 Target-change notice: when a coach applies a new daily calorie target the client is told, with fixed wording and a link to their Nutrition page, so they can answer 'are you happy with your meal plan?' (adds one notification type to the list the database already has)
do $g51$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('client_macro_target_history and notifications exist', to_regclass('public.client_macro_target_history') is not null and to_regclass('public.notifications') is not null),
      ('0306 is not already applied (the notice function is not there yet)', not exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release O (recalculation notice), step 51 (0306) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g51$;

-- ====================================================================================================
-- migration 0306_target_change_notice.sql
-- ====================================================================================================

-- Recalculation notice (nutrition phase 6). When a coach applies a new standing calorie target for a client, the client gets a bell notice with FIXED wording (never the numbers or any
-- free text) that leads to the question "are you happy with your meal plan?" on their Nutrition page. The answer table (client_nutrition_feedback) already exists (0294).
--  * New notification type 'nutrition_target_changed', added to the list the database ALREADY has (read at apply time, never typed from an older migration), so this can apply in
--    either order with any other release that widens the same list.
--  * A trigger on client_macro_target_history: a new row whose calories differ from the previous target, taking effect now or soon (not a backdated correction), tells the CLIENT once
--    (never twice in an hour while the first is unread). A client's very first target tells nobody: there is no plan to be happy or unhappy about yet.
-- New objects only. Re-runnable.

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
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['nutrition_target_changed']) as t;
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

create or replace function public.notify_on_target_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev int;
begin
  if new.calories is null then
    return new;
  end if;
  -- the target in force before this one (the latest row dated earlier)
  select h.calories into v_prev
  from public.client_macro_target_history h
  where h.athlete_id = new.athlete_id and h.group_id = new.group_id and h.effective_from < new.effective_from and h.calories is not null
  order by h.effective_from desc
  limit 1;
  if v_prev is null or v_prev = new.calories then
    return new;
  end if;
  -- a correction dated well in the past is not a new target
  if new.effective_from < current_date - 1 then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.profile_id = new.athlete_id and n.type = 'nutrition_target_changed' and n.read_at is null and n.created_at > now() - interval '1 hour'
  ) then
    return new;
  end if;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (new.athlete_id, new.group_id, 'nutrition_target_changed', 'Your daily nutrition target changed. Take a look at your meal plan and tell your coach if you are happy with it.', '/groups/' || new.group_id::text || '/nutrition');
  return new;
end;
$function$;

drop trigger if exists client_macro_target_history_notify on public.client_macro_target_history;
create trigger client_macro_target_history_notify
  after insert on public.client_macro_target_history
  for each row execute function public.notify_on_target_change();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 51 (0306)' as step, '0306 Target-change notice: when a coach applies a new daily calorie target the client is told' as what, not ((not exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace))) as in_place
) as result order by step;
