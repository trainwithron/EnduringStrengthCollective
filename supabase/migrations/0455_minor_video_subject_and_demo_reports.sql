-- Step 211 (Ron, Nov 20: S3 + S4 approved). Three safety gaps in videos.
--
-- 1. A video of a minor (S3). The age rule on form-check videos looked only at the person UPLOADING (minor_may_write is about the caller), so a coach uploading a video of a
--    13 to 17-year-old with no parent consent on file passed, and coach video check-ins to a client had no age rule at all. minor_subject_ok(person) asks about the person IN the
--    video: under 13 never; 13 to 17 only with a parent's signature or the coach's word that they talked with the parent (the same two records minor_may_write reads); 18 and
--    over, or no date of birth on file, as before. It answers only someone who coaches a group that person is in (anyone else gets false, so it says nothing about who is a
--    minor), the person themselves (their own uploads keep minor_may_write's rule, unchanged), and the server. It guards new and changed rows of session_exercise_videos (the
--    client's own video or a coach's upload for them) and coach_video_checkins (a video a coach sends a client). Existing rows are left as they are.
-- 2. On-camera consent for a shared machine demo (S4): catalog_requests.subject_consent, "Everyone shown agreed to be filmed and shared; anyone under 18 has a parent's OK".
--    Required on a filmed video sent for the shared list (a YouTube link plays from its owner's channel and keeps the rights tick only). Checked on new requests only.
-- 3. "Report this video" on the public scan pages (S4): video_reports, written only by the server (app/api/scan/report-video), read and closed only by the platform admin. When
--    Ron removes a reported demo, the removed link is kept on the report so it can be put back.
-- Nothing else changes. Re-running is safe.

begin;

create or replace function public.minor_subject_ok(p_person uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_coach boolean;
  v_has_athlete boolean;
  v_intake_dob date;
  v_profile_birthday date;
  v_youngest date;
  v_today date := current_date;
begin
  -- a video that is not of one person
  if p_person is null then
    return true;
  end if;
  -- the person themselves: their own upload is ruled by minor_may_write (the policy beside this one)
  if p_person = auth.uid() then
    return true;
  end if;
  -- only someone who coaches a group the person is in (or the server) is answered; anyone else gets false and learns nothing
  if coalesce(auth.role(), '') <> 'service_role' and not exists (
    select 1
    from public.group_memberships c
    join public.group_memberships a on a.group_id = c.group_id
    where c.profile_id = auth.uid() and c.role = 'coach' and a.profile_id = p_person
  ) then
    return false;
  end if;

  select coalesce(bool_or(role = 'coach'), false), coalesce(bool_or(role = 'athlete'), false)
    into v_has_coach, v_has_athlete
  from public.group_memberships
  where profile_id = p_person;
  -- a coach, or someone who is nobody's client, is not a minor client
  if v_has_coach or not v_has_athlete then
    return true;
  end if;

  select date_of_birth into v_intake_dob from public.client_intake where athlete_id = p_person limit 1;
  select birthday into v_profile_birthday from public.athlete_profile_details where athlete_id = p_person limit 1;
  if v_intake_dob in ('infinity'::date, '-infinity'::date) then v_intake_dob := null; end if;
  if v_profile_birthday in ('infinity'::date, '-infinity'::date) then v_profile_birthday := null; end if;
  -- the younger of the two dates on file, when there are two
  v_youngest := greatest(v_intake_dob, v_profile_birthday);

  -- no date of birth on file: as before (the coach is the one who knows)
  if v_youngest is null then
    return true;
  end if;
  if v_today >= public.age_threshold_date(v_youngest, 18) then
    return true;
  end if;
  if v_today < public.age_threshold_date(v_youngest, 13) then
    return false;
  end if;
  return exists (select 1 from public.guardian_consents where athlete_id = p_person and status = 'signed')
      or exists (select 1 from public.guardian_coach_confirmations where athlete_id = p_person);
end;
$$;

revoke all on function public.minor_subject_ok(uuid) from public;
grant execute on function public.minor_subject_ok(uuid) to authenticated, service_role;

drop policy if exists minor_subject_guard_insert on public.session_exercise_videos;
create policy minor_subject_guard_insert on public.session_exercise_videos as restrictive for insert to authenticated
  with check (public.minor_subject_ok(athlete_id));
drop policy if exists minor_subject_guard_update on public.session_exercise_videos;
create policy minor_subject_guard_update on public.session_exercise_videos as restrictive for update to authenticated
  using (true) with check (public.minor_subject_ok(athlete_id));

drop policy if exists minor_subject_guard_insert on public.coach_video_checkins;
create policy minor_subject_guard_insert on public.coach_video_checkins as restrictive for insert to authenticated
  with check (public.minor_subject_ok(athlete_id));
drop policy if exists minor_subject_guard_update on public.coach_video_checkins;
create policy minor_subject_guard_update on public.coach_video_checkins as restrictive for update to authenticated
  using (true) with check (public.minor_subject_ok(athlete_id));

-- 2. on-camera consent on a filmed demo sent for the shared machine list
alter table public.catalog_requests add column if not exists subject_consent boolean not null default false;
alter table public.catalog_requests drop constraint if exists catalog_requests_subject_consent;
alter table public.catalog_requests add constraint catalog_requests_subject_consent check (video_path is null or subject_consent) not valid;

-- 3. reports from the public scan pages
create table if not exists public.video_reports (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid references public.exercise_library(id) on delete set null,
  machine_id uuid references public.gym_machines(id) on delete set null,
  catalog_item_id uuid references public.catalog_machine_exercises(id) on delete set null,
  reason text not null check (reason in ('not_agreed', 'minor', 'copyright', 'unsafe', 'other')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  removed_video_path text,
  removed_youtube_url text,
  removed_from text check (removed_from is null or removed_from in ('shared_list', 'exercise')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists video_reports_open_idx on public.video_reports (created_at desc) where status = 'open';
alter table public.video_reports enable row level security;
-- the server writes reports; a signed-in person can at most read and close them (and only the admin, by the policies below); nobody signed out touches them
revoke all on public.video_reports from anon, authenticated;
grant select, update on public.video_reports to authenticated;
drop policy if exists video_reports_admin_read on public.video_reports;
create policy video_reports_admin_read on public.video_reports for select to authenticated using (public.is_platform_admin());
drop policy if exists video_reports_admin_close on public.video_reports;
create policy video_reports_admin_close on public.video_reports for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
-- no insert or delete policy: the server writes reports (rate limited), nobody deletes them

commit;
