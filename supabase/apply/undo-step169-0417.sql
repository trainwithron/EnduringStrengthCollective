-- UNDO for step 169 (0417). Only if a real person is wrongly blocked from writing. It drops the guard from these tables and nothing else.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $$ declare t text; begin foreach t in array array['comments','reactions','direct_messages','exercise_video_comments','training_partner_profiles','training_partner_requests','challenge_participants','progress_photos','session_exercise_videos','body_weight_logs','body_scans','transformation_cards','transformation_milestones'] loop execute format('drop policy if exists minor_write_guard_insert on public.%I', t); execute format('drop policy if exists minor_write_guard_update on public.%I', t); end loop; end; $$;
commit;
