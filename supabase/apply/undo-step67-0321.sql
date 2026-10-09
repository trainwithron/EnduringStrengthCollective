-- UNDO for step 67 (0321). Only if step 67 misbehaves. Removes the website table (and anything coaches typed into it) and the featured flag.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.coach_sites;
alter table public.pro_shop_links drop column if exists featured;
commit;
