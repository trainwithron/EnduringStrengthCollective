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
