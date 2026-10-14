-- UNDO for step 124 (0374). Only if step 124 misbehaves. Removes the asks and the notifications about them and puts back the old rule for bringing an inactive client back. It does NOT remove a workout log already made by a yes (that is real history now).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
delete from public.notifications where type = 'pr_promotion';
drop function if exists public.answer_pr_promotion(uuid, boolean);
drop function if exists public.ask_pr_promotion(uuid, text);
drop table if exists public.pr_promotions;
create or replace function public.resurface_inactive_client()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete uuid;
  v_group uuid;
begin
  -- The server's own routines (the nightly top-up of a weekly schedule) are not the client coming back.
  if tg_table_name = 'bookings' and auth.role() = 'service_role' then
    return new;
  end if;
  if tg_table_name = 'direct_messages' then
    v_athlete := new.sender_id;
  else
    v_athlete := new.athlete_id;
  end if;
  v_group := new.group_id;
  if v_athlete is null then
    return new;
  end if;
  with gone as (delete from public.client_inactive where athlete_id = v_athlete and group_id = v_group returning 1)
  insert into public.client_inactive_events (athlete_id, group_id, event, source)
  select v_athlete, v_group, 'brought_back', 'client_activity' from gone;
  return new;
end;
$function$;
commit;
