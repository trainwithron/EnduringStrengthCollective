-- RELEASE BG (COACH ASSESSMENTS ON A CLIENT'S PROFILE; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 101 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 101: A new Assessments section on a client's profile (Forms and notes) where a coach adds a title, notes, optional numbers and one file. Only the coaches of that group see them, not the client, the organization's owner or admins, or the platform. Nothing existing changes.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BG (coach assessments on a client's profile; run BEFORE the code that goes with it is live), step 101: 0355 A coach can attach their own assessments (notes, numbers and a PDF, photo or video) to a client's profile; only the coaches of that client's group can see them
do $g101$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0355 is not already applied (the assessments table does not exist yet)', to_regclass('public.client_assessments') is null),
      ('the storage and group tables the rules read exist', to_regclass('storage.objects') is not null and to_regclass('public.group_memberships') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BG (coach assessments on a client''s profile; run BEFORE the code that goes with it is live), step 101 (0355) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g101$;

-- ====================================================================================================
-- migration 0355_client_assessments.sql
-- ====================================================================================================

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

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 101 (0355)' as step, '0355 A coach can attach their own assessments' as what, not ((to_regclass('public.client_assessments') is null)) as in_place
) as result order by step;
