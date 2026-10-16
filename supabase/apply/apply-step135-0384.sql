-- STEP 135: 0384 Privacy closures: shared lists changed only by their owner, private clients stay private from organization admins, ten more client tables refuse a row about a non-member, progress photos in the owner's folder, an audit trail for access-changing rows
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: A coach can no longer change or delete another coach's food mappings or movement tags (they can still add their own). A client marked private from the organization is no longer visible to organization admins in their billing rate, set-aside and reinstated-session records, schedule requests, or (for a private one-on-one space) the space itself, its posts and its events, and an admin can no longer set such a client aside or hold, give back or take back their expired sessions. Ten more client tables refuse a row about someone who is not in the group; a progress photo must sit in its owner's own folder; and changes to organizations, memberships, consent, parent links, kiosk PINs, API keys and legal acceptances are written to the audit trail (never a PIN or key value).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.is_group_private_from_org(uuid)') is null)) then
    raise exception 'Step 135 (0384) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0384_privacy_closures.sql
-- ====================================================================================================

-- Release CK: privacy closures.
--  1. Two lists every coach shares (which food a built-in ingredient means, which movement tags an exercise has) could be rewritten or emptied by ANY coach, changing what every other coach and client sees.
--     Now a coach can add a row and change or delete only their own rows; the platform admin can change any. (The screens that add rows keep working.)
--  2. A client who is private from the organization (private_from_org) stays private from organization admins in the places the earlier rule missed: their billing rate, set-aside and reinstated-session records,
--     schedule requests and notes, and (for a private one-on-one space) the space itself, its posts and its events; and an admin can no longer run the set-aside / expiry-hold / reinstate actions on them.
-- Re-runnable.

-- 1. Shared reference lists -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "builtin_ingredient_usda_mappings_write_coach" on public.builtin_ingredient_usda_mappings;
create policy "builtin_ingredient_usda_mappings_insert_coach" on public.builtin_ingredient_usda_mappings for insert to authenticated
  with check (mapped_by = (select auth.uid()) and exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));
create policy "builtin_ingredient_usda_mappings_update_own" on public.builtin_ingredient_usda_mappings for update to authenticated
  using (mapped_by = (select auth.uid()) or public.is_platform_admin())
  with check (mapped_by = (select auth.uid()) or public.is_platform_admin());
create policy "builtin_ingredient_usda_mappings_delete_own" on public.builtin_ingredient_usda_mappings for delete to authenticated
  using (mapped_by = (select auth.uid()) or public.is_platform_admin());

drop policy if exists "exercise_biomech_tags_write_coach" on public.exercise_biomech_tags;
create policy "exercise_biomech_tags_insert_coach" on public.exercise_biomech_tags for insert to authenticated
  with check (created_by = (select auth.uid()) and exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));
create policy "exercise_biomech_tags_update_own" on public.exercise_biomech_tags for update to authenticated
  using (created_by = (select auth.uid()) or public.is_platform_admin())
  with check (created_by = (select auth.uid()) or public.is_platform_admin());
create policy "exercise_biomech_tags_delete_own" on public.exercise_biomech_tags for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_platform_admin());

-- 2. Private clients stay private from organization admins ---------------------------------------------------------------------------------------------------------------------------------
-- A one-on-one space whose client is private from the organization.
create or replace function public.is_group_private_from_org(_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.groups g
    join public.group_memberships m on m.group_id = g.id and m.role = 'athlete'
    where g.id = _group_id and g.group_kind = 'one_on_one' and m.private_from_org = true
  );
$$;
revoke all on function public.is_group_private_from_org(uuid) from public, anon;
grant execute on function public.is_group_private_from_org(uuid) to authenticated, service_role;

drop policy if exists "client_billing_rates_org_admin_select" on public.client_billing_rates;
create policy "client_billing_rates_org_admin_select" on public.client_billing_rates for select to authenticated
  using (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id));

drop policy if exists "client_inactive_select_coach" on public.client_inactive;
create policy "client_inactive_select_coach" on public.client_inactive for select to authenticated
  using (public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, athlete_id)));

drop policy if exists "client_inactive_events_select_coach" on public.client_inactive_events;
create policy "client_inactive_events_select_coach" on public.client_inactive_events for select to authenticated
  using (public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, athlete_id)));

drop policy if exists "schedule_requests_select_participants" on public.schedule_requests;
create policy "schedule_requests_select_participants" on public.schedule_requests for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_client_private_from_org(group_id, athlete_id)));

drop policy if exists "schedule_request_notes_select_coaches" on public.schedule_request_notes;
create policy "schedule_request_notes_select_coaches" on public.schedule_request_notes for select to authenticated
  using (exists (
    select 1 from public.schedule_requests r
    where r.id = schedule_request_notes.request_id
      and (public.is_group_coach(r.group_id) or (public.is_org_admin_of_group(r.group_id) and not public.is_client_private_from_org(r.group_id, r.athlete_id)))
  ));

drop policy if exists "groups_select_members_or_org_admin" on public.groups;
create policy "groups_select_members_or_org_admin" on public.groups for select to authenticated
  using (public.is_group_member(id) or (public.is_org_admin_of_group(id) and not public.is_group_private_from_org(id)));

drop policy if exists "posts_select_members" on public.posts;
create policy "posts_select_members" on public.posts for select to authenticated
  using (public.is_group_member(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id)));

drop policy if exists "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach" on public.posts for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_group_coach(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id)));

drop policy if exists "group_sessions_select_event_member" on public.group_sessions;
create policy "group_sessions_select_event_member" on public.group_sessions for select to authenticated
  using ((kind = 'event') and (public.is_group_member(group_id) or (public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id))));

-- The actions an organization admin could still run on a private client. A coach of the group is unchanged.
create or replace function public.set_client_inactive(p_athlete_id uuid, p_group_id uuid, p_inactive boolean, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
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

create or replace function public.set_credit_expiry_hold(p_athlete_id uuid, p_group_id uuid, p_until timestamp with time zone, p_note text default null::text)
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
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
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
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and auth.uid() <> p_athlete_id
     and not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
    raise exception 'not authorized';
  end if;
  return greatest(0,
    coalesce((select sum(-l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'expired'), 0)
    - coalesce((select sum(r.amount - r.undone_amount) from public.session_credit_reinstatements r where r.athlete_id = p_athlete_id and r.group_id = p_group_id), 0)
  )::integer;
end;
$function$;

create or replace function public.reinstate_expired_credits(p_athlete_id uuid, p_group_id uuid, p_amount integer, p_note text default null::text)
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
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
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
  if not (public.is_group_coach(p_group_id) or (public.is_org_admin_of_group(p_group_id) and not public.is_client_private_from_org(p_group_id, p_athlete_id))) then
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

-- 3. A row about a person is only filed in a group the person belongs to, in ten more places, and a progress photo must be stored in its owner's own folder ------------------------------------------
-- (The same rule the other client records already have, from 0340; the server and migrations are not affected.)
do $$
declare
  t text;
begin
  foreach t in array array['athlete_notes', 'client_ai_notes', 'client_progress_pins', 'session_pattern_checks', 'pro_shop_link_day_pins', 'coach_video_checkin_action_items', 'guardian_links', 'workout_logs', 'progress_photos', 'food_log_entries']
  loop
    if not exists (
      select 1 from pg_trigger tg where tg.tgrelid = ('public.' || t)::regclass and tg.tgfoid = 'public.enforce_athlete_in_group()'::regprocedure and not tg.tgisinternal
    ) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.enforce_athlete_in_group()', t || '_enforce_athlete_in_group', t);
    end if;
  end loop;
end $$;

drop policy if exists "progress_photos_write_own" on public.progress_photos;
create policy "progress_photos_write_own" on public.progress_photos for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');

-- 4. A record of changes to the rows that decide who can see and do what -------------------------------------------------------------------------------------------------------------------
-- The same append-only audit trail already kept for bookings, credits and billing. Only non-secret columns are recorded (never a PIN hash or an API key hash).
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('organizations',            'organizations_audit',            'owner_id,platform_fee_pct,restrict_cross_org_matching', 'update_only', 'id'),
      ('group_memberships',        'group_memberships_audit',        'role,private_from_org',                                 'update_only', 'group_id,profile_id'),
      ('organization_memberships', 'organization_memberships_audit', 'role,revenue_share_pct,stripe_connect_account_id',      'insert_too',  'organization_id,profile_id'),
      ('minor_consent',            'minor_consent_audit',            'verified,verified_by,method',                           'insert_too',  'athlete_id'),
      ('guardian_links',           'guardian_links_audit',           'revoked_at,expires_at',                                 'insert_too',  'id'),
      ('kiosk_pins',               'kiosk_pins_audit',               'set_by,set_at,locked_until',                            'insert_too',  'group_id,athlete_id'),
      ('coach_api_keys',           'coach_api_keys_audit',           'coach_id,created_at',                                   'insert_too',  'coach_id'),
      ('legal_acceptances',        'legal_acceptances_audit',        'document,version',                                      'insert_too',  'profile_id')
    ) as v(tbl, trg, cols, mode, keycols)
  loop
    if not exists (select 1 from pg_trigger tg where tg.tgname = spec.trg and tg.tgrelid = ('public.' || spec.tbl)::regclass) then
      execute format('create trigger %I after insert or update on public.%I for each row execute function public.audit_watch(%L, %L, %L)', spec.trg, spec.tbl, spec.cols, spec.mode, spec.keycols);
    end if;
  end loop;
end $$;

commit;
