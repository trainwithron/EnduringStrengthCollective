-- Lets an athlete swap their own prescribed exercise before starting a
-- workout — previously this table was coach-write-only. The UI only ever
-- offers the coach's own approved ladder (movement_pattern_exercises) as
-- choices, never free text, so RLS just gates ownership here (same trust
-- model already used throughout this app — e.g. workout volume/PR math —
-- rather than re-validating the exercise name server-side).
create policy "athlete_exercise_overrides_write_self" on public.athlete_exercise_overrides for all
  to authenticated using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());
