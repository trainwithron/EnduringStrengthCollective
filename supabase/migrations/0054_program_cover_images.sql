-- Program cover images, so the Programs list can render as visually
-- distinguishable cards instead of a flat list. Path convention matches
-- post-media/exercise-media: {group_id}/{program_id}/{filename}, so RLS
-- can check group membership straight from the storage path.
alter table public.programs
  add column cover_image_path text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('program-covers', 'program-covers', false, 10485760) -- private, 10MB cap
on conflict (id) do nothing;

create policy "program_covers_select_members"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'program-covers'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy "program_covers_insert_coach"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'program-covers'
    and public.is_group_coach((storage.foldername(name))[1]::uuid)
  );

create policy "program_covers_delete_coach"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'program-covers'
    and public.is_group_coach((storage.foldername(name))[1]::uuid)
  );
