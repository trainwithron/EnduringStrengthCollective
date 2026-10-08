-- Release S, part 2: the session counts for large rosters (Ron: needed before the December gym pilot, 500+ clients).
--
-- Every place that shows "8 left · 4 booked · 2 to mark" used to read EVERY open confirmed session a page at a time (1000 rows per request) and count them in the app: fine to about
-- 150 clients, slow past 300, and past about 400 the read ran out of pages and the counts were left off. This adds ONE function that returns the counts per client and group,
-- worked out inside the database:
--   booked         a confirmed session that has not ended and has not taken its session yet (unsettled)
--   to_mark        a confirmed session that has ended, is unsettled, not marked attended and not a no-show
--   prepaid_ahead  a confirmed session that has not ended and was prepaid when booked
-- The same rules the app used (lib/credit-picture.ts countBookings) for one-on-one sessions, and, new, the group classes a client is in (they were charged through their own table and
-- never counted): a class the client joined themselves already took a session when they joined, so a coming one reads as prepaid ahead (like a prepaid booking) and a finished one
-- is done; a class the coach added them to is charged when marked attended, so a coming one reads as booked and a finished, unmarked one as to mark (like an unsettled booking).
-- Cancelled classes, waiting-list places and cancelled places are not counted. It is NOT a security-definer function: it runs as the caller, so the
-- existing row security on bookings decides what is counted (a coach sees their own bookings, a client only theirs, the server everything). Filters are optional: one coach, one
-- client, a list of clients, one group. Rows come back in a fixed order so the app can read them a page at a time if there are ever more than 1000 clients with open sessions.
-- A partial index keeps the read short. New objects only (no existing function or table changes). Re-runnable.

create index if not exists bookings_open_counts_idx
  on public.bookings (coach_id, athlete_id, group_id)
  where status = 'confirmed' and credit_state in ('unsettled', 'prepaid');

create or replace function public.booking_counts(
  p_coach_id uuid default null,
  p_athlete_id uuid default null,
  p_athlete_ids uuid[] default null,
  p_group_id uuid default null
)
returns table (athlete_id uuid, group_id uuid, booked int, to_mark int, prepaid_ahead int)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select u.athlete_id,
         u.group_id,
         sum(u.booked)::int as booked,
         sum(u.to_mark)::int as to_mark,
         sum(u.prepaid_ahead)::int as prepaid_ahead
  from (
    select b.athlete_id,
           b.group_id,
           (count(*) filter (where b.end_at >= now() and b.credit_state = 'unsettled'))::int as booked,
           (count(*) filter (where b.end_at < now() and b.credit_state = 'unsettled' and b.attended_at is null and not b.no_show))::int as to_mark,
           (count(*) filter (where b.end_at >= now() and b.credit_state = 'prepaid'))::int as prepaid_ahead
    from public.bookings b
    where b.status = 'confirmed'
      and b.credit_state in ('unsettled', 'prepaid')
      and (b.end_at >= now() or (b.credit_state = 'unsettled' and b.attended_at is null and not b.no_show))
      and (p_coach_id is null or b.coach_id = p_coach_id)
      and (p_athlete_id is null or b.athlete_id = p_athlete_id)
      and (p_athlete_ids is null or b.athlete_id = any (p_athlete_ids))
      and (p_group_id is null or b.group_id = p_group_id)
    group by b.athlete_id, b.group_id
    union all
    select a.athlete_id,
           a.group_id,
           (count(*) filter (where s.end_at >= now() and not a.credit_taken))::int as booked,
           (count(*) filter (where s.end_at < now() and not a.credit_taken))::int as to_mark,
           (count(*) filter (where s.end_at >= now() and a.credit_taken))::int as prepaid_ahead
    from public.group_session_attendees a
    join public.group_sessions s on s.id = a.group_session_id
    where a.status = 'joined'
      and s.status = 'scheduled'
      and (s.end_at >= now() or not a.credit_taken)
      and (p_coach_id is null or s.coach_id = p_coach_id)
      and (p_athlete_id is null or a.athlete_id = p_athlete_id)
      and (p_athlete_ids is null or a.athlete_id = any (p_athlete_ids))
      and (p_group_id is null or a.group_id = p_group_id)
    group by a.athlete_id, a.group_id
  ) u
  group by u.athlete_id, u.group_id
  order by u.athlete_id, u.group_id;
$function$;

revoke all on function public.booking_counts(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.booking_counts(uuid, uuid, uuid[], uuid) to authenticated, service_role;
