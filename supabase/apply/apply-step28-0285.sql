-- STEP 28: 0285 a record of the rest-day nudges sent, so they can be limited to 2 in any 7 days and stopped after 3 with no response
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once. After the code deploy the nightly rest-day nudge sends at most 2 in any 7 days, stops after 3 in a row that got no response (and starts again the next time the client does something), and names the client's own goal when they have one. Until this step is applied the nightly job sends no rest-day nudges at all.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.rest_day_nudges') is null)) then
    raise exception 'Step 28 (0285) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0285_rest_day_nudge_log.sql
-- ====================================================================================================

-- A record of the rest-day nudges the app has sent, so they can be limited (Ron, Oct 6): at most 2 in any 7 days, and none after 3 in a row that got no response
-- (the client has not done a workout, check-in or habit since). Written and read only by the nightly job (the server); no signed-in user can read or write it.
-- Until this is applied the job sends no rest-day nudges at all (it cannot tell how many have gone out), so nothing is ever over-sent.
-- Re-runnable.

create table if not exists public.rest_day_nudges (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index if not exists rest_day_nudges_athlete_idx on public.rest_day_nudges (athlete_id, sent_at desc);

alter table public.rest_day_nudges enable row level security;
revoke all on public.rest_day_nudges from public, anon, authenticated;

commit;
