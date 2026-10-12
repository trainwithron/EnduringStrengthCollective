-- Release AS: a coach package can only be written by the server.
-- Before, three policies let ANY signed-in person insert, update or delete coach_packages rows as long as coach_id was their own id (they did not have to coach the group named on the row). A client could
-- file a package of their own in their coach's group with 1000 sessions and the price id of a cheap real pack, pay for the cheap one, and be granted 1000 sessions; a coach could re-point a package at
-- another organization's group. The app never writes this table from the browser: the packages route (app/api/coach/packages/route.ts) uses the server's own access, which these policies never applied to.
-- Reading is unchanged (a coach sees their own packages; a client sees the active public ones of their group). Existing packages are not touched.
drop policy if exists "coach_packages_insert_coach" on public.coach_packages;
drop policy if exists "coach_packages_update_coach" on public.coach_packages;
drop policy if exists "coach_packages_delete_coach" on public.coach_packages;
