-- RELEASE X (IMAGE UPLOADS: THE MISSING LOOK RULES ON THREE STORAGE BUCKETS): ONE paste. Steps 66 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 66: Uploading an organization logo or app icon (Organization, Branding), a coach profile photo, or a pro shop picture now works for the person who owns it. Nobody gains the right to write anywhere new.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release X (image uploads: the missing look rules on three storage buckets), step 66: 0320 Image uploads work: the organization logo and app icon, the coach profile photo and the pro shop pictures were refused for everyone because their storage buckets had no rule for looking at a file's row (adds one rule per bucket, the same people who can already write)
do $g66$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0320 is not already applied (the organization logo bucket has no look rule yet)', not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'org_branding_select_owner_admin'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release X (image uploads: the missing look rules on three storage buckets), step 66 (0320) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g66$;

-- ====================================================================================================
-- migration 0320_storage_select_policies.sql
-- ====================================================================================================

-- Release X: image uploads that always failed. Three public image buckets had a rule for who may ADD, REPLACE and REMOVE a file but none for who may LOOK AT the file's row:
-- org-branding (an organization's logo and app icon), coach-profile-photos (a coach's profile photo) and pro-shop-images (pro shop link pictures). The upload reads the new row back
-- as it adds it, so without a "look" rule the database refused every upload ("new row violates row-level security policy") even for the real owner. None of the three buckets has
-- ever held a file. This adds ONE "look" rule per bucket that is exactly the bucket's existing add/replace/remove rule, so the same people who can write can read the row, and
-- nobody else can. Pictures themselves are still shown from the public address as before. It adds rules only: no data is touched and nobody gains the right to write anywhere new.
-- Re-runnable.

drop policy if exists org_branding_select_owner_admin on storage.objects;
create policy org_branding_select_owner_admin on storage.objects for select to authenticated
  using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id = ((storage.foldername(objects.name))[1])::uuid
        and om.profile_id = (select auth.uid())
        and om.role = any (array['owner'::public.org_member_role, 'admin'::public.org_member_role])
    )
  );

drop policy if exists coach_profile_photos_select_own on storage.objects;
create policy coach_profile_photos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'coach-profile-photos' and ((storage.foldername(name))[1])::uuid = (select auth.uid()));

drop policy if exists pro_shop_images_select_own on storage.objects;
create policy pro_shop_images_select_own on storage.objects for select to authenticated
  using (bucket_id = 'pro-shop-images' and ((storage.foldername(name))[1])::uuid = (select auth.uid()));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 66 (0320)' as step, '0320 Image uploads work: the organization logo and app icon' as what, not ((not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'org_branding_select_owner_admin'))) as in_place
) as result order by step;
