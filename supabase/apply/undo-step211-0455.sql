-- UNDO step 211: removes the minor-subject guards and function, the on-camera consent column and check, and the video reports table (its rows are lost). Paste and run.
begin;
drop policy if exists minor_subject_guard_insert on public.session_exercise_videos;
drop policy if exists minor_subject_guard_update on public.session_exercise_videos;
drop policy if exists minor_subject_guard_insert on public.coach_video_checkins;
drop policy if exists minor_subject_guard_update on public.coach_video_checkins;
drop function if exists public.minor_subject_ok(uuid);
alter table public.catalog_requests drop constraint if exists catalog_requests_subject_consent;
alter table public.catalog_requests drop column if exists subject_consent;
drop table if exists public.video_reports;
commit;
