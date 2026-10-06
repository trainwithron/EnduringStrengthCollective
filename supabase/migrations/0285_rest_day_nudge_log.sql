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
