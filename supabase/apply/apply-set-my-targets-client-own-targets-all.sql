-- SET MY TARGETS (A CLIENT WITH NO TARGET FROM THEIR COACH MAY SET THEIR OWN: ONE COLUMN, ONE TRIGGER, ONE FUNCTION, THREE CLIENT POLICIES, THE NOTICE FUNCTION): ONE paste. Steps 181 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 181: Nothing changes for coaches. Once the app update that goes with it is deployed, a client with no target from their coach sees Set my targets on their Nutrition page (a calculator, then Find my real maintenance from their own weigh-ins and food log). As soon as the coach sets a target, the client's card disappears and the coach's target is the one in force.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Set my targets (a client with no target from their coach may set their own: one column, one trigger, one function, three client policies, the notice function), step 181: 0429 Set my targets: a client whose coach has set no nutrition target may set their own (one column, one trigger, one function, three client policies; the target-changed notice skips a client's own change)
do $g181$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0429 is not already applied (the helper has_coach_macro_target is not there yet; after an undo the set_by column stays and this step applies again)', not (to_regprocedure('public.has_coach_macro_target(uuid, uuid)') is not null)),
      ('notify_on_target_change is exactly the text this replaces', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '4b242454c85aff22b234860e4a6f026f' from pg_proc p where p.oid = to_regprocedure('public.notify_on_target_change()')), false)),
      ('the functions and tables it uses exist', to_regprocedure('public.minor_may_write(uuid)') is not null and to_regclass('public.client_macro_targets') is not null and to_regclass('public.group_memberships') is not null),
      ('no client policy with these names exists yet', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_macro_target_history' and policyname like 'client_macro_target_history_self_%'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Set my targets (a client with no target from their coach may set their own: one column, one trigger, one function, three client policies, the notice function), step 181 (0429) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g181$;

-- ====================================================================================================
-- migration 0429_client_sets_own_targets.sql
-- ====================================================================================================

-- Set my targets (Ron, Oct 20: "Nutrition Page set my targets option. It should give you, if your coach hasn't assigned, maybe a macro calculator and then a way to actually find your
-- real macros"). A client whose coach has not set a nutrition target may set their OWN standing target. Until now only coaches could write the target tables.
--   1. client_macro_target_history.set_by: 'coach' (every row so far, and every row a coach writes) or 'self' (the client's own).
--   2. A row written by anyone other than its athlete is always 'coach', whatever was sent.
--   3. has_coach_macro_target(athlete, group): does this client already have a target from their coach (a coach row in the history, or the old single-row table)? It answers only about the caller.
--   4. The client may insert, change and remove ONLY their own 'self' rows: in a group they belong to, only while they may write (minor_may_write: an adult, or a teen with a signed guardian),
--      only while their coach has set no target, and only dated from yesterday to tomorrow (no rewriting the past). The coach policy is unchanged; a coach's row always wins.
--   5. A client changing their own target is not told "your target changed" (notify_on_target_change returns early for a 'self' row).
-- Re-runnable.

alter table public.client_macro_target_history add column if not exists set_by text not null default 'coach';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_macro_target_history_set_by_check') then
    alter table public.client_macro_target_history add constraint client_macro_target_history_set_by_check check (set_by in ('coach', 'self'));
  end if;
end $$;

create or replace function public.macro_target_set_by_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- a row written for someone else (a coach, an organization owner) is a coach row, whatever was sent
  if auth.uid() is not null and new.athlete_id is distinct from auth.uid() then
    new.set_by := 'coach';
  end if;
  return new;
end;
$$;
revoke all on function public.macro_target_set_by_guard() from public, anon, authenticated;

drop trigger if exists client_macro_target_history_set_by on public.client_macro_target_history;
create trigger client_macro_target_history_set_by
  before insert or update on public.client_macro_target_history
  for each row execute function public.macro_target_set_by_guard();

create or replace function public.has_coach_macro_target(p_athlete uuid, p_group uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- only about the caller: asking about someone else answers false, so it cannot be used to learn about other people
  if p_athlete is null or p_athlete is distinct from auth.uid() then
    return false;
  end if;
  return exists (select 1 from public.client_macro_target_history h where h.athlete_id = p_athlete and h.group_id = p_group and h.set_by = 'coach')
      or exists (select 1 from public.client_macro_targets t where t.athlete_id = p_athlete and t.group_id = p_group);
end;
$$;
revoke all on function public.has_coach_macro_target(uuid, uuid) from public, anon;
grant execute on function public.has_coach_macro_target(uuid, uuid) to authenticated;

drop policy if exists client_macro_target_history_self_insert on public.client_macro_target_history;
create policy client_macro_target_history_self_insert on public.client_macro_target_history
  for insert to authenticated
  with check (
    athlete_id = (select auth.uid())
    and set_by = 'self'
    and exists (select 1 from public.group_memberships gm where gm.group_id = client_macro_target_history.group_id and gm.profile_id = client_macro_target_history.athlete_id)
    and public.minor_may_write((select auth.uid()))
    and not public.has_coach_macro_target(athlete_id, group_id)
    and effective_from between current_date - 1 and current_date + 1
  );

drop policy if exists client_macro_target_history_self_update on public.client_macro_target_history;
create policy client_macro_target_history_self_update on public.client_macro_target_history
  for update to authenticated
  using (
    athlete_id = (select auth.uid())
    and set_by = 'self'
    and public.minor_may_write((select auth.uid()))
    and not public.has_coach_macro_target(athlete_id, group_id)
  )
  with check (
    athlete_id = (select auth.uid())
    and set_by = 'self'
    and exists (select 1 from public.group_memberships gm where gm.group_id = client_macro_target_history.group_id and gm.profile_id = client_macro_target_history.athlete_id)
    and public.minor_may_write((select auth.uid()))
    and not public.has_coach_macro_target(athlete_id, group_id)
    and effective_from between current_date - 1 and current_date + 1
  );

drop policy if exists client_macro_target_history_self_delete on public.client_macro_target_history;
create policy client_macro_target_history_self_delete on public.client_macro_target_history
  for delete to authenticated
  using (
    athlete_id = (select auth.uid())
    and set_by = 'self'
    and exists (select 1 from public.group_memberships gm where gm.group_id = client_macro_target_history.group_id and gm.profile_id = client_macro_target_history.athlete_id)
    and public.minor_may_write((select auth.uid()))
    and not public.has_coach_macro_target(athlete_id, group_id)
  );

-- 5. The live text of notify_on_target_change (0306), with one early return added for a client's own row.
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
  -- a client setting their own target is not told it changed
  if new.set_by = 'self' then
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
revoke all on function public.notify_on_target_change() from public, anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 181 (0429)' as step, '0429 Set my targets: a client whose coach has set no nutrition target may set their own' as what, not ((not (to_regprocedure('public.has_coach_macro_target(uuid, uuid)') is not null))) as in_place
) as result order by step;
