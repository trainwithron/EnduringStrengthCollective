-- UNDO for step 66 (0320). Only if step 66 misbehaves. Removes the three new rules, which puts uploads back to how they were (refused).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists org_branding_select_owner_admin on storage.objects;
drop policy if exists coach_profile_photos_select_own on storage.objects;
drop policy if exists pro_shop_images_select_own on storage.objects;
commit;
