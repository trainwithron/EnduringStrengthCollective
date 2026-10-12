-- STEP 85 (PRECHECK, run first, changes nothing): 0339 A transformation card can only use the athlete's own photos and milestone, in a group they are a client of, and is never made for a client under 18
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0339 is not already applied (the new insert rule is absent)',
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_insert_own')),
    ('the earlier card write rule is in place',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_write_own')),
    ('the tables the new rule checks exist',
      to_regclass('public.progress_photos') is not null and to_regclass('public.transformation_milestones') is not null and to_regclass('public.client_intake') is not null)
) as checks(check_name, ok);
