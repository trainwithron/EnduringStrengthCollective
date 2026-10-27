-- UNDO for step 191 (0438). Only if step 191 misbehaves, and only while the app update that goes with it is NOT live (it reads and writes coach_profiles.instagram_handle). It puts the handle back on the public page rows (a coach with no page row loses the handle they typed) and removes the new column.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.coach_booking_pages add column if not exists instagram_handle text;
do $undo$
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_booking_pages_instagram_handle_format') then
    alter table public.coach_booking_pages add constraint coach_booking_pages_instagram_handle_format check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$');
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_profiles' and column_name = 'instagram_handle') then
    execute 'update public.coach_booking_pages b set instagram_handle = p.instagram_handle from public.coach_profiles p where p.coach_id = b.coach_id and p.instagram_handle is not null';
  end if;
end $undo$;
alter table public.coach_profiles drop constraint if exists coach_profiles_instagram_handle_format;
alter table public.coach_profiles drop column if exists instagram_handle;
commit;
