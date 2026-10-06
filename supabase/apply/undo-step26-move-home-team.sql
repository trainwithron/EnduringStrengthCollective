-- UNDO for step 26 (move-home-team). Only if the move turns out to be wrong. Puts The Home Team back into Enduring Strength Co. (memberships added to Coast2Coast Fitness stay; they change nothing).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
update public.groups set organization_id = 'b7318b19-a17e-4412-88f1-51d68fcf026f' where id = '060017b5-e613-4204-a101-c6a14c3a9630' and organization_id = 'e369f4a7-c53a-4532-95d3-f7bd14e40e48';
commit;
