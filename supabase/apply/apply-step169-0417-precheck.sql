-- STEP 169 (PRECHECK, run first, changes nothing): 0417 Release AF3e paste C: the restrictive write guard on the rest of the covered tables (comments, reactions, messages, photos, weights and the others)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('step 168 (the posts guard) is already applied',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'minor_write_guard_insert')),
    ('0417 is not already applied (the guard is not on these tables yet)',
      not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'minor_write_guard_insert'))),
    ('every table it guards exists',
      to_regclass('public.comments') is not null and to_regclass('public.reactions') is not null and to_regclass('public.direct_messages') is not null and to_regclass('public.exercise_video_comments') is not null and to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.challenge_participants') is not null and to_regclass('public.progress_photos') is not null and to_regclass('public.session_exercise_videos') is not null and to_regclass('public.body_weight_logs') is not null and to_regclass('public.body_scans') is not null and to_regclass('public.transformation_cards') is not null and to_regclass('public.transformation_milestones') is not null)
) as checks(check_name, ok);
