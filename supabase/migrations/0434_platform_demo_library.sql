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
