-- STEP 125: 0375 InBody scans from a photo of the result sheet: the scans, a private place for the photos, and the one function that saves a scan
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the code that goes with it is live. Then a client (next to where they log body weight) or a coach can photograph an InBody sheet, check the numbers the app read from it, and save the scan; the photo is kept privately for the client and their coaches, and the scan feeds the graphs. A scan's weight becomes that day's weigh-in only when asked and never over one already logged.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.body_scans') is null)) then
    raise exception 'Step 125 (0375) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0375_inbody_scans.sql
-- ====================================================================================================

-- Release CE: InBody scans from a photo of the result sheet.
--
--   * body_scans: one row per scan (date, weight, skeletal muscle, fat mass, percent body fat, lean mass, BMI, water, visceral fat level, BMR, score, and the limb-by-limb numbers when the sheet
--     has them). Everything is stored in pounds / litres whatever the sheet printed. The client reads their own, the client's coach reads them; there is NO update (a wrong scan is deleted and added
--     again); the client can delete their own, a coach can delete a scan they added themselves.
--   * the photo of the sheet is kept in a private bucket, inbody-scans, at group / person / file. The person and the coaches of the group can read it; the person (or the coach who uploaded it)
--     can delete it.
--   * save_body_scan (the only way a scan is written): the person themself or a coach of the group, for a person who is in the group. It writes the scan and, only when asked and only when no
--     weigh-in exists for that date, that day's weigh-in (never overwriting one: body_weight_logs is one row per person per day).
-- Re-runnable.

create table if not exists public.body_scans (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  scan_date date not null,
  weight_lb numeric check (weight_lb is null or weight_lb between 20 and 1000),
  skeletal_muscle_lb numeric check (skeletal_muscle_lb is null or skeletal_muscle_lb between 5 and 400),
  body_fat_mass_lb numeric check (body_fat_mass_lb is null or body_fat_mass_lb between 1 and 800),
  percent_body_fat numeric check (percent_body_fat is null or percent_body_fat between 1 and 80),
  lean_mass_lb numeric check (lean_mass_lb is null or lean_mass_lb between 10 and 600),
  bmi numeric check (bmi is null or bmi between 8 and 90),
  total_body_water_l numeric check (total_body_water_l is null or total_body_water_l between 5 and 200),
  ecw_ratio numeric check (ecw_ratio is null or ecw_ratio between 0.2 and 0.6),
  visceral_level numeric check (visceral_level is null or visceral_level between 1 and 40),
  bmr_kcal numeric check (bmr_kcal is null or bmr_kcal between 400 and 6000),
  inbody_score numeric check (inbody_score is null or inbody_score between 0 and 100),
  segments jsonb,
  photo_path text,
  source text not null default 'photo' check (source in ('photo', 'manual')),
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists body_scans_athlete_date_idx on public.body_scans (athlete_id, group_id, scan_date desc);

alter table public.body_scans enable row level security;
revoke all on public.body_scans from anon;
drop policy if exists "body_scans_read" on public.body_scans;
create policy "body_scans_read" on public.body_scans for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
drop policy if exists "body_scans_delete" on public.body_scans;
create policy "body_scans_delete" on public.body_scans for delete to authenticated
  using (athlete_id = (select auth.uid()) or (uploaded_by = (select auth.uid()) and public.is_group_coach(group_id)));
-- No insert or update policy: a scan is written only by save_body_scan below.

drop trigger if exists body_scans_enforce_athlete_in_group on public.body_scans;
create trigger body_scans_enforce_athlete_in_group before insert or update on public.body_scans for each row execute function public.enforce_athlete_in_group();

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'body_scans' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.body_scans as restrictive for all to authenticated
      using (public.group_in_active_org(group_id))
      with check (public.group_in_active_org(group_id));
  end if;
end;
$$;

-- The private bucket for the photos: path is group / person / file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('inbody-scans', 'inbody-scans', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "inbody_scans_storage_select" on storage.objects;
create policy "inbody_scans_storage_select" on storage.objects for select to authenticated
  using (bucket_id = 'inbody-scans' and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_group_coach(((storage.foldername(name))[1])::uuid)));
drop policy if exists "inbody_scans_storage_insert" on storage.objects;
create policy "inbody_scans_storage_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inbody-scans'
    and (
      ((storage.foldername(name))[2] = (select auth.uid())::text and public.is_group_member(((storage.foldername(name))[1])::uuid))
      or public.is_group_coach(((storage.foldername(name))[1])::uuid)
    )
  );
drop policy if exists "inbody_scans_storage_delete" on storage.objects;
create policy "inbody_scans_storage_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'inbody-scans'
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (select 1 from public.body_scans b where b.photo_path = name and b.uploaded_by = (select auth.uid()) and public.is_group_coach(b.group_id))
    )
  );

-- The one writer. p_values holds the numbers already turned into pounds and litres (the app does that and shows them to the person first); the table's own limits refuse anything impossible.
create or replace function public.save_body_scan(p_group uuid, p_athlete uuid, p_values jsonb, p_photo_path text, p_use_as_weigh_in boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_date := nullif(p_values ->> 'scanDate', '')::date;
  if v_date is null or v_date > current_date + 1 then
    raise exception 'the scan needs a date that is not in the future';
  end if;
  v_weight := nullif(p_values ->> 'weightLb', '')::numeric;

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
$$;

revoke all on function public.save_body_scan(uuid, uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.save_body_scan(uuid, uuid, jsonb, text, boolean) to authenticated;

commit;
