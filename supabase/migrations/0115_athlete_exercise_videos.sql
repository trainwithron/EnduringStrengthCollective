-- Athlete-submitted exercise video + coach feedback. Attaches to
-- session_exercises (this specific exercise, as actually performed this
-- specific session) — not per-set (nothing that granular exists in the
-- UI today) and not whole-session (that's workout_logs, deliberately
-- summary-only).
create table public.session_exercise_videos (
  id uuid primary key default uuid_generate_v4(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  video_path text not null,
  created_at timestamptz not null default now()
);
create index session_exercise_videos_exercise_idx on public.session_exercise_videos(session_exercise_id);
create index session_exercise_videos_group_idx on public.session_exercise_videos(group_id);

-- Flat thread, no reply-nesting — a per-exercise back-and-forth doesn't
-- need comments.parent_comment_id's nesting.
create table public.exercise_video_comments (
  id uuid primary key default uuid_generate_v4(),
  video_id uuid not null references public.session_exercise_videos(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index exercise_video_comments_video_idx on public.exercise_video_comments(video_id);

alter table public.session_exercise_videos enable row level security;
-- Write allows the group's coach too, not just the athlete themselves —
-- the wellness-checkin build found this the hard way: without it, the
-- already-shipped "View as Client" mode (a coach filming a client in
-- person, uploading on their behalf) breaks.
create policy "videos_select_own_or_coach" on public.session_exercise_videos for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "videos_write_own_or_coach" on public.session_exercise_videos for all
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id))
  with check (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

alter table public.exercise_video_comments enable row level security;
create policy "video_comments_select_participant" on public.exercise_video_comments for select
  to authenticated using (
    public.is_group_coach(group_id)
    or exists (select 1 from public.session_exercise_videos v where v.id = video_id and v.athlete_id = (select auth.uid()))
  );
create policy "video_comments_insert_participant" on public.exercise_video_comments for insert
  to authenticated with check (
    author_id = (select auth.uid()) and (
      public.is_group_coach(group_id)
      or exists (select 1 from public.session_exercise_videos v where v.id = video_id and v.athlete_id = (select auth.uid()))
    )
  );
create policy "video_comments_delete_own_or_coach" on public.exercise_video_comments for delete
  to authenticated using (author_id = (select auth.uid()) or public.is_group_coach(group_id));

-- Storage: private bucket, path {group_id}/{session_exercise_id}/{uuid}.{ext} —
-- same "first folder segment is the RLS-checkable group id" convention as
-- post-media (0004) and exercise-media (0014).
insert into storage.buckets (id, name, public, file_size_limit)
values ('athlete-exercise-videos', 'athlete-exercise-videos', false, 104857600) -- private, 100MB cap
on conflict (id) do nothing;

create policy "athlete_exercise_videos_select_members"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'athlete-exercise-videos'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy "athlete_exercise_videos_insert_own_or_coach"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'athlete-exercise-videos'
    and (
      public.is_group_member((storage.foldername(name))[1]::uuid)
      or public.is_group_coach((storage.foldername(name))[1]::uuid)
    )
  );

create policy "athlete_exercise_videos_delete_own_or_coach"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'athlete-exercise-videos'
    and (
      owner = auth.uid()
      or public.is_group_coach((storage.foldername(name))[1]::uuid)
    )
  );

-- Notifications reuse the existing 'comment' type rather than widening
-- notifications' check constraint — established precedent (0073, 0093
-- both reuse 'comment' for reply/mention notifications too; `type` isn't
-- read anywhere in the UI for branching, only body/link_path matter).

-- An athlete's uploaded video notifies every coach of the group — skipped
-- if the uploader IS a coach (the View-as-Client case shouldn't notify
-- the coach of their own upload).
create or replace function public.notify_on_video_upload()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_athlete_name text;
  v_coach record;
begin
  select full_name into v_athlete_name from public.profiles where id = new.athlete_id;

  for v_coach in
    select profile_id from public.group_memberships
    where group_id = new.group_id and role = 'coach' and profile_id <> auth.uid()
  loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      v_coach.profile_id,
      new.group_id,
      'comment',
      coalesce(v_athlete_name, 'A client') || ' uploaded a form-check video',
      '/sessions/' || (select session_id from public.session_exercises where id = new.session_exercise_id)
    );
  end loop;
  return new;
end;
$$;
create trigger trg_notify_on_video_upload after insert on public.session_exercise_videos
for each row execute function public.notify_on_video_upload();

-- A comment on a video notifies the video's own athlete (if the
-- commenter isn't them) and every coach of the group (if the commenter
-- isn't them) — keeps both sides of a back-and-forth in the loop without
-- needing comments.parent_comment_id-style reply-target resolution.
create or replace function public.notify_on_video_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_video record;
  v_author_name text;
  v_link text;
  v_coach record;
begin
  select athlete_id, session_exercise_id into v_video from public.session_exercise_videos where id = new.video_id;
  if v_video.athlete_id is null then return new; end if;

  select full_name into v_author_name from public.profiles where id = new.author_id;
  v_link := '/sessions/' || (select session_id from public.session_exercises where id = v_video.session_exercise_id);

  if v_video.athlete_id <> new.author_id then
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_video.athlete_id, new.group_id, 'comment', coalesce(v_author_name, 'Your coach') || ' left feedback on your video', v_link);
  end if;

  for v_coach in
    select profile_id from public.group_memberships
    where group_id = new.group_id and role = 'coach' and profile_id <> new.author_id
  loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach.profile_id, new.group_id, 'comment', coalesce(v_author_name, 'Someone') || ' commented on a client video', v_link);
  end loop;
  return new;
end;
$$;
create trigger trg_notify_on_video_comment after insert on public.exercise_video_comments
for each row execute function public.notify_on_video_comment();
