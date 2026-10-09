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
