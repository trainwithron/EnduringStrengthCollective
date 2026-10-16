-- Release CJ: closures for minors and health data found by the audit.
--  1. Training partners: a child, or a person with no birthdate on file, is never shown to or matched with other members of their organization (the cross-organization branch already had this rule; the same-organization
--     branch did not), and cannot switch their own profile to visible. Free text is length-limited and one person can send only so many requests an hour.
--  2. A parent view link: the secret is always made by the database (a coach's browser can no longer choose it), and a link can only be made once parental consent has been verified.
--  3. A weigh-in must be a believable weight; the InBody photo bucket takes images only; saving a scan bounds its date and its size.
--  4. A new notification type, so a coach can be told that a child under 13 is waiting for parental consent.
-- Existing rows are left as they are (the new limits are NOT VALID where old data might not fit). Re-runnable.

-- 1. Training partners -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.training_partner_is_protected(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.training_partner_is_minor(p_athlete_id) or public.training_partner_intake_incomplete(p_athlete_id);
$$;
revoke all on function public.training_partner_is_protected(uuid) from public, anon;
grant execute on function public.training_partner_is_protected(uuid) to authenticated, service_role;

drop policy if exists "training_partner_profiles_select_visible" on public.training_partner_profiles;
create policy "training_partner_profiles_select_visible" on public.training_partner_profiles for select to authenticated
  using (
    visible = true
    and not public.training_partners_mutually_blocked(athlete_id, (select auth.uid()))
    and (
      (public.training_partners_share_org(athlete_id, (select auth.uid())) and not public.training_partner_is_protected(athlete_id) and not public.training_partner_is_protected((select auth.uid())))
      or (public.training_partners_cross_org_enabled() and not public.training_partner_is_restricted(athlete_id) and not public.training_partner_is_restricted((select auth.uid())))
    )
  );

drop policy if exists "training_partner_profiles_write_own" on public.training_partner_profiles;
create policy "training_partner_profiles_write_own" on public.training_partner_profiles for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()) and (visible = false or not public.training_partner_is_protected((select auth.uid()))));

drop policy if exists "training_partner_requests_insert_own" on public.training_partner_requests;
create policy "training_partner_requests_insert_own" on public.training_partner_requests for insert to authenticated
  with check (
    from_athlete_id = (select auth.uid())
    and not public.training_partners_mutually_blocked(to_athlete_id, (select auth.uid()))
    and (
      (public.training_partners_share_org(to_athlete_id, (select auth.uid())) and not public.training_partner_is_protected(to_athlete_id) and not public.training_partner_is_protected((select auth.uid())))
      or (public.training_partners_cross_org_enabled() and not public.training_partner_is_restricted(to_athlete_id) and not public.training_partner_is_restricted((select auth.uid())))
    )
  );

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_partner_profiles_text_limits' and conrelid = 'public.training_partner_profiles'::regclass) then
    alter table public.training_partner_profiles add constraint training_partner_profiles_text_limits
      check (char_length(coalesce(location_text, '')) <= 120 and char_length(coalesce(looking_for, '')) <= 400) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'training_partner_requests_text_limits' and conrelid = 'public.training_partner_requests'::regclass) then
    alter table public.training_partner_requests add constraint training_partner_requests_text_limits
      check (char_length(message) <= 500 and char_length(coalesce(response_message, '')) <= 500) not valid;
  end if;
end $$;

create or replace function public.limit_training_partner_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and (select count(*) from public.training_partner_requests r where r.from_athlete_id = new.from_athlete_id and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have sent the most partner requests allowed in an hour. Try again later.';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_training_partner_requests() from public, anon, authenticated;
drop trigger if exists training_partner_requests_hourly_limit on public.training_partner_requests;
create trigger training_partner_requests_hourly_limit before insert on public.training_partner_requests
  for each row execute function public.limit_training_partner_requests();

-- 2. Parent view links -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.set_guardian_link_token()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Always made here, whatever the caller sent: 64 random hex characters.
  new.access_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  return new;
end;
$$;
revoke all on function public.set_guardian_link_token() from public, anon, authenticated;
drop trigger if exists guardian_links_set_token on public.guardian_links;
create trigger guardian_links_set_token before insert on public.guardian_links
  for each row execute function public.set_guardian_link_token();
alter table public.guardian_links alter column access_token set default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

create or replace function public.guardian_link_allowed(p_athlete_id uuid, p_group_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.is_group_coach(p_group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = p_group_id and gm.profile_id = p_athlete_id and gm.role = 'athlete'
    )
    and exists (
      select 1 from public.minor_consent mc
      where mc.athlete_id = p_athlete_id and mc.group_id = p_group_id and mc.verified = true
    )
    and exists (
      select 1 from public.client_intake ci
      where ci.athlete_id = p_athlete_id
        and ci.date_of_birth is not null
        and ci.date_of_birth > (
          (now() at time zone coalesce(
            (select p.timezone from public.profiles p, pg_timezone_names z where p.id = (select auth.uid()) and z.name = p.timezone),
            'America/New_York'
          ))::date - interval '13 years'
        )::date
    );
$function$;

-- 3. Weigh-ins, scan photos, saving a scan --------------------------------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'body_weight_logs_weight_range' and conrelid = 'public.body_weight_logs'::regclass) then
    alter table public.body_weight_logs add constraint body_weight_logs_weight_range check (weight >= 20 and weight <= 1500) not valid;
  end if;
end $$;

update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'inbody-scans';

create or replace function public.save_body_scan(p_group uuid, p_athlete uuid, p_values jsonb, p_photo_path text, p_use_as_weigh_in boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_date date;
  v_weight numeric;
  v_weigh_in boolean := false;
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (
    (auth.uid() = p_athlete and coalesce(public.is_group_member(p_group), false))
    or (coalesce(public.is_group_coach(p_group), false) and coalesce(public.group_in_active_org(p_group), false))
  ) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.group_memberships m where m.group_id = p_group and m.profile_id = p_athlete) then
    raise exception 'that person is not in this group';
  end if;
  if p_photo_path is not null and p_photo_path not like p_group::text || '/' || p_athlete::text || '/%' then
    raise exception 'the photo is not stored where it should be';
  end if;
  if p_values is null or octet_length(p_values::text) > 8000 then
    raise exception 'that scan is too large';
  end if;
  v_date := nullif(p_values ->> 'scanDate', '')::date;
  if v_date is null or v_date > current_date + 1 or v_date < date '2000-01-01' then
    raise exception 'the scan needs a date between 2000 and today';
  end if;
  v_weight := nullif(p_values ->> 'weightLb', '')::numeric;
  if v_weight is not null and (v_weight < 20 or v_weight > 1500) then
    raise exception 'that weight does not look right';
  end if;

  insert into public.body_scans (
    athlete_id, group_id, scan_date, weight_lb, skeletal_muscle_lb, body_fat_mass_lb, percent_body_fat, lean_mass_lb, bmi,
    total_body_water_l, ecw_ratio, visceral_level, bmr_kcal, inbody_score, segments, photo_path, source, uploaded_by
  ) values (
    p_athlete, p_group, v_date, v_weight,
    nullif(p_values ->> 'skeletalMuscleLb', '')::numeric, nullif(p_values ->> 'bodyFatMassLb', '')::numeric, nullif(p_values ->> 'percentBodyFat', '')::numeric,
    nullif(p_values ->> 'leanMassLb', '')::numeric, nullif(p_values ->> 'bmi', '')::numeric, nullif(p_values ->> 'totalBodyWaterL', '')::numeric,
    nullif(p_values ->> 'ecwRatio', '')::numeric, nullif(p_values ->> 'visceralLevel', '')::numeric, nullif(p_values ->> 'bmrKcal', '')::numeric,
    nullif(p_values ->> 'inbodyScore', '')::numeric, case when jsonb_typeof(p_values -> 'segments') = 'object' then p_values -> 'segments' else null end,
    p_photo_path, case when p_photo_path is null then 'manual' else 'photo' end, auth.uid()
  ) returning id into v_id;

  -- The scan's weight can stand as that day's weigh-in, but only when asked and never over one that is already there.
  if coalesce(p_use_as_weigh_in, false) and v_weight is not null then
    insert into public.body_weight_logs (athlete_id, group_id, logged_date, weight)
    values (p_athlete, p_group, v_date, v_weight)
    on conflict (athlete_id, logged_date) do nothing;
    get diagnostics v_rows = row_count;
    v_weigh_in := v_rows > 0;
  end if;
  return jsonb_build_object('id', v_id, 'weighInSaved', v_weigh_in);
end;
$function$;

-- 4. A notification type for "a child is waiting for parental consent" ----------------------------------------------------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'booking_request', 'comment', 'credits_expired', 'direct_message', 'email_changed', 'goal_answered', 'goal_proposed', 'gym_visitor_lead', 'late_change', 'macros_assigned', 'meal_plan_try',
  'milestone_celebration', 'minor_consent_needed', 'new_training_block', 'nutrition_allergies_updated', 'nutrition_baseline_ready', 'nutrition_preferences_changed', 'nutrition_prompt_answered',
  'nutrition_target_changed', 'partner_request', 'partner_request_accepted', 'pr_promotion', 'program_assigned', 'recurring_booking_conflict', 'request_decision', 'schedule_applied',
  'schedule_request', 'schedule_resumed', 'session_pattern_note', 'trainer_dispatch_offer', 'trainer_dispatch_question', 'waitlist_slot_offered'
]));
