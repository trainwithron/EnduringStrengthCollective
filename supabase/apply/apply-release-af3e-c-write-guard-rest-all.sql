-- RELEASE AF3E PASTE C (THE RESTRICTIVE WRITE GUARD ON THE REST OF THE COVERED TABLES; APPLY ONLY AFTER PASTE B HAS RUN CLEAN FOR A FEW DAYS): ONE paste. Steps 169 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 169: From now on a client with no birthday on file, under 13, or 13 to 17 without a signed guardian cannot write to these tables, save a body scan, or upload a picture or video to the four media buckets by calling the database directly. Nothing changes for coaches, adult clients, staff or a teen with a signed guardian. Apply only after step 168 (posts) has run a few days with no false blocks.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AF3e paste C (the restrictive write guard on the rest of the covered tables; apply only after paste B has run clean for a few days), step 169: 0417 Release AF3e paste C: the restrictive write guard on the rest of the covered tables (comments, reactions, messages, photos, weights and the others)
do $g169$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('step 168 (the posts guard) is already applied', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'minor_write_guard_insert')),
      ('0417 is not already applied (the guard is not on these tables yet)', not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'minor_write_guard_insert'))),
      ('the function it replaces exists', to_regprocedure('public.save_body_scan(uuid, uuid, jsonb, text, boolean)') is not null),
      ('every table it guards exists', to_regclass('public.comments') is not null and to_regclass('public.reactions') is not null and to_regclass('public.direct_messages') is not null and to_regclass('public.exercise_video_comments') is not null and to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.challenge_participants') is not null and to_regclass('public.progress_photos') is not null and to_regclass('public.session_exercise_videos') is not null and to_regclass('public.body_weight_logs') is not null and to_regclass('public.body_scans') is not null and to_regclass('public.transformation_cards') is not null and to_regclass('public.transformation_milestones') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AF3e paste C (the restrictive write guard on the rest of the covered tables; apply only after paste B has run clean for a few days), step 169 (0417) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g169$;

-- ====================================================================================================
-- migration 0417_minor_write_guard_rest.sql
-- ====================================================================================================

-- Release AF3 (e), paste C: the same restrictive insert/update guard as paste B (0416), on the rest of the tables where a child's words, picture or body would be shown to or stored for other people. Applied only after
-- `posts` has run in production for a few days with no false blocks. Delete is left alone. Re-runnable. Not covered on purpose: nutrition tables, training logs, wellness check-ins, safety actions (blocks, reports, support) and the
-- birthday/health steps (see docs/AF3E_MINOR_WRITE_DESIGN.md).
do $$
declare
  t text;
begin
  foreach t in array array[
    -- shows the child to other people
    'comments', 'reactions', 'direct_messages', 'exercise_video_comments', 'training_partner_profiles', 'training_partner_requests', 'challenge_participants',
    -- pictures, video and body measurements
    'progress_photos', 'session_exercise_videos', 'body_weight_logs', 'body_scans', 'transformation_cards', 'transformation_milestones'
  ] loop
    execute format('drop policy if exists minor_write_guard_insert on public.%I', t);
    execute format('create policy minor_write_guard_insert on public.%I as restrictive for insert to authenticated with check (public.minor_may_write((select auth.uid())))', t);
    execute format('drop policy if exists minor_write_guard_update on public.%I', t);
    execute format('create policy minor_write_guard_update on public.%I as restrictive for update to authenticated using (public.minor_may_write((select auth.uid()))) with check (public.minor_may_write((select auth.uid())))', t);
  end loop;
end;
$$;

-- ---- Two ways round the table policies, closed ---------------------------------------------------------------------------------------------------------
-- 1. A scan is written only by save_body_scan (a security definer function: it bypasses the table policies above). It now asks the same question first. A coach saving a scan for a child passes (the check is about the caller).
--    Identical to the live function otherwise: one added check after the existing authorization.
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
  -- A person the age rules stop (no birthday on file, under 13, or 13 to 17 without a signed guardian) cannot save a scan, or the weigh-in it carries, by calling this directly.
  if not public.minor_may_write(auth.uid()) then
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

-- 2. The pictures and videos themselves. The table rows are refused for a blocked child, but a file could still be uploaded to their own folder. Restrictive policies on the four buckets that hold a child's pictures or
--    video; every other bucket is untouched (the test is on the bucket name). The server key bypasses them.
drop policy if exists minor_write_guard_storage_insert on storage.objects;
create policy minor_write_guard_storage_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('progress-photos', 'athlete-exercise-videos', 'post-media', 'inbody-scans') or public.minor_may_write((select auth.uid())));
drop policy if exists minor_write_guard_storage_update on storage.objects;
create policy minor_write_guard_storage_update on storage.objects as restrictive for update to authenticated
  using (bucket_id not in ('progress-photos', 'athlete-exercise-videos', 'post-media', 'inbody-scans') or public.minor_may_write((select auth.uid())))
  with check (bucket_id not in ('progress-photos', 'athlete-exercise-videos', 'post-media', 'inbody-scans') or public.minor_may_write((select auth.uid())));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 169 (0417)' as step, '0417 Release AF3e paste C: the restrictive write guard on the rest of the covered tables' as what, not ((not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'minor_write_guard_insert')))) as in_place
) as result order by step;
