-- RELEASE AF3E PASTE B (THE RESTRICTIVE WRITE GUARD ON POSTS ONLY): ONE paste. Steps 168 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 168: From now on a client with no birthday on file, under 13, or 13 to 17 without a signed guardian cannot add or edit a post by calling the database directly. Nothing changes for coaches, adult clients, staff or a teen with a signed guardian.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AF3e paste B (the restrictive write guard on posts only), step 168: 0416 Release AF3e paste B: the restrictive write guard on posts only
do $g168$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('step 167 (the function) is already applied', to_regprocedure('public.minor_may_write(uuid)') is not null),
      ('0416 is not already applied (the posts guard is not there yet)', not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'minor_write_guard_insert'))),
      ('the table it guards exists', to_regclass('public.posts') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AF3e paste B (the restrictive write guard on posts only), step 168 (0416) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g168$;

-- ====================================================================================================
-- migration 0416_minor_write_guard_posts.sql
-- ====================================================================================================

-- Release AF3 (e), paste B: the first table that uses minor_may_write (migration 0415): `posts`. A RESTRICTIVE policy is ANDed with the policies already there, so nothing that is refused today becomes allowed and
-- nothing changes for a person the function says true to (every coach, every adult client, a teen with a signed guardian, staff). A client with no birthday on file, under 13, or 13 to 17 without a signed guardian can no
-- longer insert or edit a post by writing to the database directly. Delete is left alone (anyone can take their own post down). The server key bypasses row security, so server routes are unaffected. Re-runnable.
drop policy if exists minor_write_guard_insert on public.posts;
create policy minor_write_guard_insert on public.posts as restrictive for insert to authenticated
  with check (public.minor_may_write((select auth.uid())));
drop policy if exists minor_write_guard_update on public.posts;
create policy minor_write_guard_update on public.posts as restrictive for update to authenticated
  using (public.minor_may_write((select auth.uid())))
  with check (public.minor_may_write((select auth.uid())));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 168 (0416)' as step, '0416 Release AF3e paste B: the restrictive write guard on posts only' as what, not ((not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'minor_write_guard_insert')))) as in_place
) as result order by step;
