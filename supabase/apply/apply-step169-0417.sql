-- STEP 169: 0417 Release AF3e paste C: the restrictive write guard on the rest of the covered tables (comments, reactions, messages, photos, weights and the others)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: From now on a client with no birthday on file, under 13, or 13 to 17 without a signed guardian cannot write to these tables by calling the database directly. Nothing changes for coaches, adult clients, staff or a teen with a signed guardian. Apply only after step 168 (posts) has run a few days with no false blocks.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'minor_write_guard_insert')))) then
    raise exception 'Step 169 (0417) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0417_minor_write_guard_rest.sql
-- ====================================================================================================

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

commit;
