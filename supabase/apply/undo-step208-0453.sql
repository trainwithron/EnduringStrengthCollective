-- UNDO: step 208 (the shared machine list). Removes the shared list, the requests and the links from coaches' machines (their machines and exercises stay, as their own).
-- The machine-demos bucket and any videos in it are left in place (storage files are removed from the Storage page, not from SQL); with its rules gone nobody but the server reads it.
-- Exercises added to the exercise catalog by an approval (batch 'machine-catalog') stay: coaches' library rows may point at them.

begin;

drop policy if exists machine_demos_select on storage.objects;
drop policy if exists machine_demos_insert_own_folder on storage.objects;
drop function if exists public.is_catalog_demo_object(text);
drop function if exists public.review_catalog_request(uuid, boolean, text);
drop index if exists public.gym_machine_exercises_catalog_item_idx;
drop index if exists public.gym_machines_catalog_idx;
alter table public.gym_machine_exercises drop column if exists catalog_item_id;
alter table public.gym_machines drop column if exists catalog_machine_id;
drop table if exists public.catalog_requests;
drop function if exists public.limit_catalog_requests();
drop function if exists public.is_any_group_coach();
drop table if exists public.catalog_machine_exercises;
drop table if exists public.catalog_machines;

commit;
