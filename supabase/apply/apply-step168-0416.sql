-- STEP 168: 0416 Release AF3e paste B: the restrictive write guard on posts only
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: From now on a client with no birthday on file, under 13, or 13 to 17 without a signed guardian cannot add or edit a post by calling the database directly. Nothing changes for coaches, adult clients, staff or a teen with a signed guardian.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'minor_write_guard_insert')))) then
    raise exception 'Step 168 (0416) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
