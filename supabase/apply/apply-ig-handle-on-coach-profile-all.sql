-- A COACH'S INSTAGRAM HANDLE IN THEIR OWN SETTINGS (MOVED TO COACH_PROFILES, ONE PLACE): ONE paste. Steps 191 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 191: Every coach sees Instagram handle in their own Settings (computer and phone) once the app update is deployed (deploy it right after).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== A coach's Instagram handle in their own Settings (moved to coach_profiles, one place), step 191: 0438 A coach's Instagram handle moves to the coach's own settings (coach_profiles), so every coach can set it, with or without a public page
do $g191$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0438 is not already applied (coach_profiles has no instagram_handle yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_profiles' and column_name = 'instagram_handle')),
      ('step 190 is in: coach_booking_pages has instagram_handle', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle')),
      ('no handle is saved on any page row yet (nothing to copy)', not exists (select 1 from public.coach_booking_pages b where to_jsonb(b) ->> 'instagram_handle' is not null)),
      ('coach_profiles is keyed by coach_id', exists (select 1 from pg_constraint where conrelid = 'public.coach_profiles'::regclass and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (coach_id)')),
      ('coach_profiles has exactly its two rules (0196): read own or a client''s coach, change own', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'coach_profiles') = 2 and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_profiles' and policyname = 'coach_profiles_select_own_or_client') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_profiles' and policyname = 'coach_profiles_write_own'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'A coach''s Instagram handle in their own Settings (moved to coach_profiles, one place), step 191 (0438) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g191$;

-- ====================================================================================================
-- migration 0438_ig_handle_on_coach_profile.sql
-- ====================================================================================================

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

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 191 (0438)' as step, '0438 A coach''s Instagram handle moves to the coach''s own settings' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_profiles' and column_name = 'instagram_handle'))) as in_place
) as result order by step;
