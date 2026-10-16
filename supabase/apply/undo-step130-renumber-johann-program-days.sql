-- UNDO for step 130 (renumber-johann-program-days). Only if the renumbering was wrong. Puts the four day numbers back as they were (1, 1, 2, 3). Undo step 131 first if it has been applied.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
update public.workouts set day_index = 1 where id in ('0f92ad85-c134-4731-b027-446254949a76', 'fd73bdb4-1510-4b32-a521-219222921c12');
update public.workouts set day_index = 2 where id = '27c5131f-b421-4eeb-b2e4-3291ce60d67c';
update public.workouts set day_index = 3 where id = '33a67f22-e93d-4585-849f-c9894d0bc89f';
commit;
