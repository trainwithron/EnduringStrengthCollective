-- Calendar Spotter Phase 2 (calendar_spotter_phase2_and_cross_industry_
-- scheduling_optimization_research_sept19.md) — the one real schema gap
-- found: bookings.start_at/end_at (the calendared slot) and
-- athlete_sessions.duration_seconds (the real logged time) both already
-- exist and are densely populated, but nothing links a specific booking
-- to the session that fulfilled it, so "booked 60 min, actually took 40"
-- isn't queryable. Nullable — a freeform/unbooked session, a walk-in
-- QR-code session, or a CSV-imported historical session correctly has
-- no real booked slot to compare against.
alter table public.athlete_sessions
  add column booking_id uuid references public.bookings(id) on delete set null;
create index athlete_sessions_booking_id_idx on public.athlete_sessions(booking_id);
