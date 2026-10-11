-- Release AN: the "What do you call your people?" card on a coach's Home is asked ONCE, for good. Until now the "already answered" flag lived only in the browser (localStorage), so a new
-- browser, a cleared profile or a second device asked again, and choosing the default word never counted as an answer. Now it is a date on the coach's own profile: empty until they pick any
-- word (the default included) or close the card, and the card is shown only while it is empty.
-- Backfill: every coach who exists now counts as having answered, so nobody who is already using the app is asked again. A coach who joins after this is asked once.
alter table public.profiles add column if not exists terminology_asked_at timestamptz;
update public.profiles set terminology_asked_at = now()
 where terminology_asked_at is null
   and id in (select gm.profile_id from public.group_memberships gm where gm.role = 'coach');
