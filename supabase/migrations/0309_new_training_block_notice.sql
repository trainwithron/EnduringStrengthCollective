-- New training block notice (phase 7). When a coach moves a client to a new nutrition phase, the client sees ONE plain line in their bell: "Your coach started a new training block with you."
-- (no phase words, no numbers). Clients do not need to understand phases, only that a new block has started.
--  * New notification type 'new_training_block', added to the list the database ALREADY has (read at apply time, never typed from an older migration), so this can apply in any order
--    with any other release that widens the same list.
--  * A trigger on client_phase_plans: when the PHASE of a plan changes (an update, not the plan's first creation), the client is told once (never twice in an hour while the first is
--    unread). It does not fire when only the review date or the planned next phase changed, and it does not tell the client when the client's own confirmation caused the change.
--  * The trigger function is closed to the public and signed-in users like every other internal function (a trigger still fires).
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
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['new_training_block']) as t;
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

create or replace function public.notify_on_new_training_block()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only a change of the phase itself, and not one the client made by confirming something (they already know).
  if new.phase is not distinct from old.phase then
    return new;
  end if;
  if auth.uid() is not distinct from new.athlete_id then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.profile_id = new.athlete_id and n.type = 'new_training_block' and n.read_at is null and n.created_at > now() - interval '1 hour'
  ) then
    return new;
  end if;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (new.athlete_id, new.group_id, 'new_training_block', 'Your coach started a new training block with you.', '/groups/' || new.group_id::text);
  return new;
end;
$function$;

revoke all on function public.notify_on_new_training_block() from public, anon, authenticated;

drop trigger if exists client_phase_plans_notify_new_block on public.client_phase_plans;
create trigger client_phase_plans_notify_new_block
  after update of phase on public.client_phase_plans
  for each row execute function public.notify_on_new_training_block();
