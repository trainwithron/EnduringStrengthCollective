-- UNDO for step 181 (0429). Only if step 181 misbehaves. Clients can no longer write targets (the three policies and the helper go), the trigger goes, and the notice function is put back exactly as before. The set_by column stays (a client's own rows stay marked 'self'; nothing reads it without the app update).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists client_macro_target_history_self_insert on public.client_macro_target_history;
drop policy if exists client_macro_target_history_self_update on public.client_macro_target_history;
drop policy if exists client_macro_target_history_self_delete on public.client_macro_target_history;
drop function if exists public.has_coach_macro_target(uuid, uuid);
drop trigger if exists client_macro_target_history_set_by on public.client_macro_target_history;
drop function if exists public.macro_target_set_by_guard();
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
revoke all on function public.notify_on_target_change() from public, anon, authenticated;
commit;
