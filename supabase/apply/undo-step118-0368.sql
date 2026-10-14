-- UNDO for step 118 (0368). Only if step 118 misbehaves. Removes the placement and audience settings (every card goes back to showing as it did before: the public page then shows nothing from the Pro Shop until the code is rolled back too).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.coach_packages drop constraint if exists coach_packages_audience_check;
alter table public.pro_shop_links drop constraint if exists pro_shop_links_audience_check;
alter table public.coach_packages drop column if exists show_on_home, drop column if exists show_in_pro_shop, drop column if exists audience, drop column if exists audience_group_id, drop column if exists buyer_joins_space;
alter table public.pro_shop_links drop column if exists show_on_public, drop column if exists audience, drop column if exists audience_group_id;
commit;
