-- A coach's Instagram handle belongs to the coach, not to their public page (Ron, Oct 27: "there needs to be a place to input ig handle individually"): every coach sets it in their own
-- Settings, with or without a public page. It moves from coach_booking_pages (0437) to coach_profiles, the coach's own settings row (bio, photo, completion message): only the coach writes
-- it, their clients may read it (the table's existing rules, 0196). Same rule as before: 1 to 30 letters, digits, "." and "_", stored without the "@". Any handle already saved on a page
-- row is copied across (making the coach's coach_profiles row when they have none), then the page row's column is dropped, so there is one place. Re-runnable.

alter table public.coach_profiles add column if not exists instagram_handle text;

do $check$
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_profiles_instagram_handle_format' and conrelid = 'public.coach_profiles'::regclass) then
    alter table public.coach_profiles
      add constraint coach_profiles_instagram_handle_format check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$');
  end if;
end
$check$;

do $move$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle') then
    execute $copy$
      insert into public.coach_profiles (coach_id, instagram_handle)
      select coach_id, instagram_handle from public.coach_booking_pages where instagram_handle is not null
      on conflict (coach_id) do update set instagram_handle = excluded.instagram_handle, updated_at = now()
    $copy$;
    alter table public.coach_booking_pages drop constraint if exists coach_booking_pages_instagram_handle_format;
    alter table public.coach_booking_pages drop column instagram_handle;
  end if;
end
$move$;
