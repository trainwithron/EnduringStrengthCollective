-- UNDO for step 186 (0434). Only if step 186 misbehaves. The rule and the two functions go; every coach sees only their own demos again, as before. Safe with the app update live (it treats a missing function as no platform demos).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop policy if exists exercise_media_select_platform_demo on storage.objects;
drop function if exists public.is_platform_demo_object(text);
drop function if exists public.platform_demo_rows();
commit;
