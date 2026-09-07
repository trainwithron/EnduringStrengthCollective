-- ============================================================================
-- Exercise video: a coach's own uploaded clip or a YouTube link, attached to
-- the shared exercise_library entry so it's reusable everywhere that
-- exercise name appears (same sharing model exercise_library already has).
-- ============================================================================

alter table public.exercise_library
  add column video_path text,  -- storage object path in the exercise-media bucket
  add column youtube_url text;

-- BUG FIX while touching this table: exercise_library is currently
-- select-gated to created_by = auth.uid() only (0010_exercise_library.sql),
-- which would block an athlete from ever seeing a video their coach
-- attached. Add an additional read path for any athlete who shares a group
-- with that coach. Additive — the existing owner-only policy is untouched.
create policy "exercise_library_select_group_member"
  on public.exercise_library for select
  to authenticated
  using (
    exists (
      select 1 from public.group_memberships gm_coach
      join public.group_memberships gm_viewer on gm_viewer.group_id = gm_coach.group_id
      where gm_coach.profile_id = exercise_library.created_by
        and gm_coach.role = 'coach'
        and gm_viewer.profile_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('exercise-media', 'exercise-media', false, 104857600) -- private, 100MB cap
on conflict (id) do nothing;

-- Path convention: {coach_id}/{filename} — same shape as post-media's
-- {group_id}/... convention in 0004_feed_realtime_storage.sql. Read is
-- owner-or-shared-group (an athlete needs to view their own coach's video);
-- write stays owner-only.
create policy "exercise_media_select_owner_or_shared_group"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'exercise-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.group_memberships gm_coach
        join public.group_memberships gm_viewer on gm_viewer.group_id = gm_coach.group_id
        where gm_coach.profile_id = (storage.foldername(name))[1]::uuid
          and gm_coach.role = 'coach'
          and gm_viewer.profile_id = auth.uid()
      )
    )
  );

create policy "exercise_media_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "exercise_media_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);
