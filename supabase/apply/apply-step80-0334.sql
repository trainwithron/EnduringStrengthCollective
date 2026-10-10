-- STEP 80: 0334 A client can choose whether their first name is shown on their shared workout pictures (on for everyone until they switch it off)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone until a client switches it off in their own Settings. Everyone's first name keeps showing on their shared workout pictures, as it does now.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'show_name_on_share'))) then
    raise exception 'Step 80 (0334) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0334_share_name_setting.sql
-- ====================================================================================================

-- Release AL: a client chooses whether their FIRST NAME is shown on their shared workout pictures (the post-workout card and the picture they post). Default ON for everyone,
-- including under 18 (Ron's decision, 2026-10-10). One small column on profiles, next to preferred_share_background (0197). The public share page reads it on the server (with the
-- service role, like the rest of the card), so no new read rule is needed. It changes nothing for anyone until they switch it off.
-- New column only, nothing else touched.
alter table public.profiles add column if not exists show_name_on_share boolean not null default true;

commit;
