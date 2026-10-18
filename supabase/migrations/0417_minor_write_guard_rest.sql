-- Release AF3 (e), paste C: the same restrictive insert/update guard as paste B (0416), on the rest of the tables where a child's words, picture or body would be shown to or stored for other people. Applied only after
-- `posts` has run in production for a few days with no false blocks. Delete is left alone. Re-runnable. Not covered on purpose: nutrition tables, training logs, wellness check-ins, safety actions (blocks, reports, support) and the
-- birthday/health steps (see docs/AF3E_MINOR_WRITE_DESIGN.md).
do $$
declare
  t text;
begin
  foreach t in array array[
    -- shows the child to other people
    'comments', 'reactions', 'direct_messages', 'exercise_video_comments', 'training_partner_profiles', 'training_partner_requests', 'challenge_participants',
    -- pictures, video and body measurements
    'progress_photos', 'session_exercise_videos', 'body_weight_logs', 'body_scans', 'transformation_cards', 'transformation_milestones'
  ] loop
    execute format('drop policy if exists minor_write_guard_insert on public.%I', t);
    execute format('create policy minor_write_guard_insert on public.%I as restrictive for insert to authenticated with check (public.minor_may_write((select auth.uid())))', t);
    execute format('drop policy if exists minor_write_guard_update on public.%I', t);
    execute format('create policy minor_write_guard_update on public.%I as restrictive for update to authenticated using (public.minor_may_write((select auth.uid()))) with check (public.minor_may_write((select auth.uid())))', t);
  end loop;
end;
$$;
