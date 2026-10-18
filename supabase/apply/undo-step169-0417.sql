-- UNDO for step 169 (0417). Only if a real person is wrongly blocked from writing. It drops the guard from these tables and the four file buckets, and puts save_body_scan back to the text it had.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $$ declare t text; begin foreach t in array array['comments','reactions','direct_messages','exercise_video_comments','training_partner_profiles','training_partner_requests','challenge_participants','progress_photos','session_exercise_videos','body_weight_logs','body_scans','transformation_cards','transformation_milestones'] loop execute format('drop policy if exists minor_write_guard_insert on public.%I', t); execute format('drop policy if exists minor_write_guard_update on public.%I', t); end loop; end; $$;
drop policy if exists minor_write_guard_storage_insert on storage.objects;
drop policy if exists minor_write_guard_storage_update on storage.objects;
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
commit;
