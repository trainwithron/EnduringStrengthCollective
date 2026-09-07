-- ============================================================================
-- Enable realtime on feed tables + storage bucket for post media
-- ============================================================================
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.reactions;

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', false)
on conflict (id) do nothing;

-- Storage path convention: {group_id}/{post_id}/{filename}
-- so RLS can check group membership from the path itself.
create policy "post_media_select_members"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-media'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy "post_media_insert_members"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-media'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy "post_media_delete_own_or_coach"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-media'
    and (
      owner = auth.uid()
      or public.is_group_coach((storage.foldername(name))[1]::uuid)
    )
  );
