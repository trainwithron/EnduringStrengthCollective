-- Closes a real race: the dashboard's "auto add" mode checked whether a
-- suggestion already existed, then inserted if not — two concurrent page
-- loads (a prefetch racing a direct navigation, two tabs) could both pass
-- the check and both insert, duplicating the calendar entry. A trigger_key
-- plus a partial unique index makes the insert itself atomic instead:
-- the database enforces uniqueness, so the app can safely upsert with
-- ignoreDuplicates rather than check-then-insert.
alter table public.calendar_events
  add column trigger_key text;

-- Scoped to suggestion-type rows only — custom events never set this and
-- aren't deduplicated. Distinguishes the two independent suggestion kinds
-- (a "program ending" and a "macros missing" suggestion can both be
-- legitimately active for the same athlete at once) while still
-- preventing the same kind from being inserted twice for the same
-- athlete.
create unique index calendar_events_suggestion_unique
  on public.calendar_events (coach_id, linked_athlete_id, trigger_key)
  where trigger_key is not null;
