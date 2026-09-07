-- ============================================================================
-- BUG FIX: exercise_library (0010_exercise_library.sql) only ever had
-- SELECT/INSERT/DELETE policies — no UPDATE. That was invisible until now
-- because the only prior writer was an upsert with ignoreDuplicates:true
-- (pure insert-or-skip). Attaching video/YouTube data to an exercise name
-- that's already in the library performs a real UPDATE, which RLS silently
-- filtered to zero rows — the client never saw an error (upsert doesn't
-- surface a rejected-by-RLS row as a Postgrest error), so the UI showed the
-- attachment as saved while nothing persisted.
-- ============================================================================
create policy "exercise_library_update_own"
  on public.exercise_library for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());
