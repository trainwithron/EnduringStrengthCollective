-- PLATFORM DEMO LIBRARY (EVERY COACH AND CLIENT SEES THE SPOTLIGHT DEMOS WHEN THEIR COACH HAS NONE): ONE paste. Steps 186 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 186: Nothing changes on any screen until the app update that goes with it is deployed. Then a coach with no demo of their own for an exercise (and their clients) sees the Spotlight demo; a coach's own demo always wins.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Platform demo library (every coach and client sees the Spotlight demos when their coach has none), step 186: 0434 The platform demo library: every coach and client can see the demos on a platform admin's exercises (one read function, one file-read rule)
do $g186$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0434 is not already applied', to_regprocedure('public.platform_demo_rows()') is null and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'exercise_media_select_platform_demo')),
      ('the library, the platform admin mark and the bucket exist', to_regclass('public.exercise_library') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_platform_admin') and exists (select 1 from storage.buckets where id = 'exercise-media')),
      ('the existing file rules are the three expected ones (read own or shared group, upload own folder, delete own folder)', (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('exercise_media_select_owner_or_shared_group', 'exercise_media_insert_own_folder', 'exercise_media_delete_own')) = 3)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Platform demo library (every coach and client sees the Spotlight demos when their coach has none), step 186 (0434) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g186$;

-- ====================================================================================================
-- migration 0434_platform_demo_library.sql
-- ====================================================================================================

-- The platform demo library (Oct 26; Ron: "i am building the sofware wide video library out as a starting point and coaches can add there own later").
-- The demos on a platform admin's own exercise_library rows (today: Ron's) are the library every coach and client falls back to when their coach has no demo of their own
-- for an exercise (lib/exercise-demo.ts: the coach's own demo first, then the platform one, then nothing).
--  * platform_demo_rows(): the name, uploaded video path and YouTube link of each platform-admin row that HAS a demo. Nothing else of those rows (their notes, category, the rows
--    without a demo) is ever shown; exercise_library's own row security is unchanged (another coach still cannot read Ron's rows). Signed-in people only.
--  * is_platform_demo_object(name): whether a stored file is the uploaded video of one of those rows.
--  * exercise_media_select_platform_demo: a signed-in person can read (and so get a signed link to) exactly those files in the exercise-media bucket. Uploading and deleting
--    are unchanged: only into and from your own folder.
-- Re-runnable.

create or replace function public.platform_demo_rows()
returns table (name text, video_path text, youtube_url text)
language sql
stable
security definer
set search_path = public
as $$
  select l.name, l.video_path, l.youtube_url
  from public.exercise_library l
  join public.profiles p on p.id = l.created_by
  where auth.uid() is not null
    and p.is_platform_admin = true
    and (l.video_path is not null or nullif(btrim(l.youtube_url), '') is not null)
  order by l.name, l.id
$$;
revoke all on function public.platform_demo_rows() from public, anon;
grant execute on function public.platform_demo_rows() to authenticated;

create or replace function public.is_platform_demo_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exercise_library l
    join public.profiles p on p.id = l.created_by
    where p.is_platform_admin = true
      and l.video_path = p_name
      and split_part(p_name, '/', 1) = l.created_by::text
  )
$$;
revoke all on function public.is_platform_demo_object(text) from public, anon;
grant execute on function public.is_platform_demo_object(text) to authenticated;

drop policy if exists exercise_media_select_platform_demo on storage.objects;
create policy exercise_media_select_platform_demo on storage.objects for select to authenticated
  using (bucket_id = 'exercise-media' and public.is_platform_demo_object(name));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 186 (0434)' as step, '0434 The platform demo library: every coach and client can see the demos on a platform admin''s exercises' as what, not ((to_regprocedure('public.platform_demo_rows()') is null and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'exercise_media_select_platform_demo'))) as in_place
) as result order by step;
