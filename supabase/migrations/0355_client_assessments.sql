-- Release BG: a coach can attach their own assessments to a client's profile: a title, notes, optional numbers, and one file (a PDF, a photo or a video). They are the COACH's working records:
-- only the coaches of the client's group can see or change them (not the client, not the organization's owner or admins, not the platform), and they sit in a private storage bucket.
create table if not exists public.client_assessments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  notes text check (notes is null or char_length(notes) <= 4000),
  measurements text check (measurements is null or char_length(measurements) <= 1000),
  file_path text,
  file_name text check (file_name is null or char_length(file_name) <= 200),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists client_assessments_athlete_idx on public.client_assessments (athlete_id, group_id);

alter table public.client_assessments enable row level security;
revoke all on public.client_assessments from anon;
create policy "client_assessments_coach_manage" on public.client_assessments for all to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id) and created_by = (select auth.uid()) and exists (select 1 from public.group_memberships gm where gm.group_id = client_assessments.group_id and gm.profile_id = client_assessments.athlete_id));
-- Like every table whose rows belong to a group, it carries the organization-wall rule (Release AZ) when that is installed.
do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null then
    create policy "org_wall_header" on public.client_assessments as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;

-- Private bucket: {group_id}/{athlete_id}/{uuid}.{ext}. Only the coaches of that group read, add or remove files.
insert into storage.buckets (id, name, public, file_size_limit)
values ('client-assessments', 'client-assessments', false, 209715200)
on conflict (id) do nothing;

create policy "client_assessments_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'client-assessments' and public.is_group_coach((storage.foldername(name))[1]::uuid));
create policy "client_assessments_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-assessments' and public.is_group_coach((storage.foldername(name))[1]::uuid));
create policy "client_assessments_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'client-assessments' and public.is_group_coach((storage.foldername(name))[1]::uuid));
