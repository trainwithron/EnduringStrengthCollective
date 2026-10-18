-- RELEASE AF3E PASTE C (THE RESTRICTIVE WRITE GUARD ON THE REST OF THE COVERED TABLES; APPLY ONLY AFTER PASTE B HAS RUN CLEAN FOR A FEW DAYS): ONE paste. Steps 169 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 169: From now on a client with no birthday on file, under 13, or 13 to 17 without a signed guardian cannot write to these tables by calling the database directly. Nothing changes for coaches, adult clients, staff or a teen with a signed guardian. Apply only after step 168 (posts) has run a few days with no false blocks.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AF3e paste C (the restrictive write guard on the rest of the covered tables; apply only after paste B has run clean for a few days), step 169: 0417 Release AF3e paste C: the restrictive write guard on the rest of the covered tables (comments, reactions, messages, photos, weights and the others)
do $g169$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('step 168 (the posts guard) is already applied', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'minor_write_guard_insert')),
      ('0417 is not already applied (the guard is not on these tables yet)', not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'minor_write_guard_insert'))),
      ('every table it guards exists', to_regclass('public.comments') is not null and to_regclass('public.reactions') is not null and to_regclass('public.direct_messages') is not null and to_regclass('public.exercise_video_comments') is not null and to_regclass('public.training_partner_profiles') is not null and to_regclass('public.training_partner_requests') is not null and to_regclass('public.challenge_participants') is not null and to_regclass('public.progress_photos') is not null and to_regclass('public.session_exercise_videos') is not null and to_regclass('public.body_weight_logs') is not null and to_regclass('public.body_scans') is not null and to_regclass('public.transformation_cards') is not null and to_regclass('public.transformation_milestones') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AF3e paste C (the restrictive write guard on the rest of the covered tables; apply only after paste B has run clean for a few days), step 169 (0417) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g169$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 169 (0417)' as step, '0417 Release AF3e paste C: the restrictive write guard on the rest of the covered tables' as what, not ((not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'minor_write_guard_insert')))) as in_place
) as result order by step;
