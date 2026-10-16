-- UNDO for step 135 (0384). Only if step 135 misbehaves. Puts back the earlier rules and functions exactly, removes the new triggers and the audit triggers. Rows already written to the audit trail stay (it is append-only).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists organizations_audit on public.organizations;
drop trigger if exists group_memberships_audit on public.group_memberships;
drop trigger if exists organization_memberships_audit on public.organization_memberships;
drop trigger if exists minor_consent_audit on public.minor_consent;
drop trigger if exists guardian_links_audit on public.guardian_links;
drop trigger if exists kiosk_pins_audit on public.kiosk_pins;
drop trigger if exists coach_api_keys_audit on public.coach_api_keys;
drop trigger if exists legal_acceptances_audit on public.legal_acceptances;
drop policy if exists "progress_photos_write_own" on public.progress_photos;
create policy "progress_photos_write_own" on public.progress_photos for all to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
drop trigger if exists athlete_notes_enforce_athlete_in_group on public.athlete_notes;
drop trigger if exists client_ai_notes_enforce_athlete_in_group on public.client_ai_notes;
drop trigger if exists client_progress_pins_enforce_athlete_in_group on public.client_progress_pins;
drop trigger if exists session_pattern_checks_enforce_athlete_in_group on public.session_pattern_checks;
drop trigger if exists pro_shop_link_day_pins_enforce_athlete_in_group on public.pro_shop_link_day_pins;
drop trigger if exists coach_video_checkin_action_items_enforce_athlete_in_group on public.coach_video_checkin_action_items;
drop trigger if exists guardian_links_enforce_athlete_in_group on public.guardian_links;
drop trigger if exists workout_logs_enforce_athlete_in_group on public.workout_logs;
drop trigger if exists progress_photos_enforce_athlete_in_group on public.progress_photos;
drop trigger if exists food_log_entries_enforce_athlete_in_group on public.food_log_entries;
create or replace function public.set_client_inactive(p_athlete_id uuid, p_group_id uuid, p_inactive boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete') then
    raise exception 'that client is not in this group';
  end if;
  if p_inactive then
    if not exists (select 1 from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id) then
      insert into public.client_inactive_events (athlete_id, group_id, event, source, by_profile) values (p_athlete_id, p_group_id, 'set_aside', 'coach', auth.uid());
    end if;
    insert into public.client_inactive (athlete_id, group_id, since, note, set_by)
    values (p_athlete_id, p_group_id, now(), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (athlete_id, group_id) do update set since = now(), note = excluded.note, set_by = excluded.set_by;
  else
    if exists (select 1 from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id) then
      delete from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id;
      insert into public.client_inactive_events (athlete_id, group_id, event, source, by_profile) values (p_athlete_id, p_group_id, 'brought_back', 'coach', auth.uid());
    end if;
  end if;
end;
$function$;
create or replace function public.set_credit_expiry_hold(p_athlete_id uuid, p_group_id uuid, p_until timestamp with time zone, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
  v_what text;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if p_until is not null and (p_until <= now() or p_until > now() + interval '5 years') then
    raise exception 'the hold must end between now and five years from now';
  end if;

  select balance into v_balance from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found then
    raise exception 'this client has no session balance';
  end if;

  update public.session_credits set expiry_hold_until = p_until, updated_at = now() where athlete_id = p_athlete_id and group_id = p_group_id;

  v_what := case when p_until is null then 'Expiry hold removed' else 'Expiry held until ' || to_char(p_until, 'Mon FMDD, YYYY') end;
  insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, created_by)
  values (p_athlete_id, p_group_id, 'adjusted', 0, v_balance, v_what || coalesce(': ' || nullif(btrim(p_note), ''), ''), auth.uid());
end;
$function$;
create or replace function public.reinstatable_expired_credits(p_athlete_id uuid, p_group_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and auth.uid() <> p_athlete_id
     and not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  return greatest(0,
    coalesce((select sum(-l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'expired'), 0)
    - coalesce((select sum(r.amount - r.undone_amount) from public.session_credit_reinstatements r where r.athlete_id = p_athlete_id and r.group_id = p_group_id), 0)
  )::integer;
end;
$function$;
create or replace function public.reinstate_expired_credits(p_athlete_id uuid, p_group_id uuid, p_amount integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_available int;
  v_new_balance int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'choose at least one session';
  end if;
  -- Serialise two answers for the same client so the same expired sessions cannot be given back twice.
  perform 1 from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  v_available := public.reinstatable_expired_credits(p_athlete_id, p_group_id);
  if p_amount > v_available then
    raise exception 'only % expired sessions can be given back', v_available;
  end if;
  v_new_balance := public.apply_session_credit_change(
    p_athlete_id, p_group_id, p_amount, 'adjusted',
    'Reinstated expired sessions' || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    null, auth.uid()
  );
  insert into public.session_credit_reinstatements (athlete_id, group_id, amount, created_by)
  values (p_athlete_id, p_group_id, p_amount, auth.uid());
  return v_new_balance;
end;
$function$;
create or replace function public.undo_expired_reinstatement(p_athlete_id uuid, p_group_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_outstanding int;
  v_balance int;
  v_since timestamptz;
  v_left int;
  v_row record;
  v_take int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'choose at least one session';
  end if;
  select balance into v_balance from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found then
    raise exception 'this client has no session balance';
  end if;
  select coalesce(sum(amount - undone_amount), 0), max(greatest(created_at, coalesce(last_undone_at, created_at)))
    into v_outstanding, v_since
    from public.session_credit_reinstatements where athlete_id = p_athlete_id and group_id = p_group_id;
  if p_amount > v_outstanding then
    raise exception 'only % reinstated sessions can be taken back', v_outstanding;
  end if;
  if p_amount > v_balance then
    raise exception 'the client has already used some of those sessions';
  end if;
  -- Only while nothing has happened to the client's sessions since the give-back (or since the last take-back): a session used, bought, assigned,
  -- refunded or charged since then means this could take back other sessions than the ones that were given back.
  if exists (
    select 1 from public.session_credit_ledger l
    where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.amount <> 0 and l.created_at > v_since
  ) then
    raise exception 'the client''s sessions have changed since they were given back, so this can no longer be undone here; adjust the balance by hand instead';
  end if;

  -- Take the sessions back from the newest give-backs first.
  v_left := p_amount;
  for v_row in
    select id, amount - undone_amount as open_amount from public.session_credit_reinstatements
    where athlete_id = p_athlete_id and group_id = p_group_id and amount - undone_amount > 0
    order by created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_row.open_amount);
    update public.session_credit_reinstatements set undone_amount = undone_amount + v_take, last_undone_at = clock_timestamp() where id = v_row.id;
    v_left := v_left - v_take;
  end loop;
  return public.apply_session_credit_change(p_athlete_id, p_group_id, -p_amount, 'adjusted', 'Reinstatement undone', null, auth.uid());
end;
$function$;
drop policy if exists "group_sessions_select_event_member" on public.group_sessions;
create policy "group_sessions_select_event_member" on public.group_sessions for select to authenticated using ((kind = 'event') and (public.is_group_member(group_id) or public.is_org_admin_of_group(group_id)));
drop policy if exists "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach" on public.posts for delete to authenticated using ((author_id = (select auth.uid())) or public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));
drop policy if exists "posts_select_members" on public.posts;
create policy "posts_select_members" on public.posts for select to authenticated using (public.is_group_member(group_id) or public.is_org_admin_of_group(group_id));
drop policy if exists "groups_select_members_or_org_admin" on public.groups;
create policy "groups_select_members_or_org_admin" on public.groups for select to authenticated using (public.is_group_member(id) or public.is_org_admin_of_group(id));
drop policy if exists "schedule_request_notes_select_coaches" on public.schedule_request_notes;
create policy "schedule_request_notes_select_coaches" on public.schedule_request_notes for select to authenticated using (exists (select 1 from public.schedule_requests r where r.id = schedule_request_notes.request_id and (public.is_group_coach(r.group_id) or public.is_org_admin_of_group(r.group_id))));
drop policy if exists "schedule_requests_select_participants" on public.schedule_requests;
create policy "schedule_requests_select_participants" on public.schedule_requests for select to authenticated using ((athlete_id = (select auth.uid())) or public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));
drop policy if exists "client_inactive_events_select_coach" on public.client_inactive_events;
create policy "client_inactive_events_select_coach" on public.client_inactive_events for select to authenticated using (public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));
drop policy if exists "client_inactive_select_coach" on public.client_inactive;
create policy "client_inactive_select_coach" on public.client_inactive for select to authenticated using (public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));
drop policy if exists "client_billing_rates_org_admin_select" on public.client_billing_rates;
create policy "client_billing_rates_org_admin_select" on public.client_billing_rates for select to authenticated using (public.is_org_admin_of_group(group_id));
drop function if exists public.is_group_private_from_org(uuid);
drop policy if exists "exercise_biomech_tags_insert_coach" on public.exercise_biomech_tags;
drop policy if exists "exercise_biomech_tags_update_own" on public.exercise_biomech_tags;
drop policy if exists "exercise_biomech_tags_delete_own" on public.exercise_biomech_tags;
create policy "exercise_biomech_tags_write_coach" on public.exercise_biomech_tags for all to authenticated using (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')) with check (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));
drop policy if exists "builtin_ingredient_usda_mappings_insert_coach" on public.builtin_ingredient_usda_mappings;
drop policy if exists "builtin_ingredient_usda_mappings_update_own" on public.builtin_ingredient_usda_mappings;
drop policy if exists "builtin_ingredient_usda_mappings_delete_own" on public.builtin_ingredient_usda_mappings;
create policy "builtin_ingredient_usda_mappings_write_coach" on public.builtin_ingredient_usda_mappings for all to authenticated using (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')) with check (exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));
commit;
