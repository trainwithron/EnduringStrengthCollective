-- Close the public (anon) read policies behind shared workout cards.
--
-- /share/[postId] used to read posts, workout_logs, profiles, groups, session_exercises, set_logs and organizations as the
-- signed-out visitor, which required "anyone" read policies on all of them. Anyone holding the public API key could
-- therefore list every shared workout, its author's name and picture, every set logged in it and every group name,
-- directly from the database, with no link needed. The page now reads on the server (service role) for the one post a link
-- names, returns only what the card shows, and shortens the name to first name and last initial, so none of these
-- policies is needed.
--
-- APPLY THIS AFTER the new app code is deployed: the previous code still reads these tables as the visitor, and would
-- show "This workout card isn't available" for every public link the moment the policies go.

drop policy if exists "posts_select_public_workout_share" on public.posts;
drop policy if exists "workout_logs_select_public_workout_share" on public.workout_logs;
drop policy if exists "profiles_select_public_workout_share" on public.profiles;
drop policy if exists "groups_select_public_workout_share" on public.groups;
drop policy if exists "session_exercises_select_public_workout_share" on public.session_exercises;
drop policy if exists "set_logs_select_public_workout_share" on public.set_logs;
drop policy if exists "organizations_select_public_workout_share" on public.organizations;

-- The column grants that existed only so those policies could expose a group's name and organization to anon.
revoke select on public.groups from anon;
