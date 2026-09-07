-- habit_logs_write (FOR ALL) already covers SELECT for the same
-- condition as habit_logs_select — the two were redundant permissive
-- policies on the same role/action (flagged by the Supabase performance
-- advisor), each forcing Postgres to evaluate both on every read.
drop policy "habit_logs_select" on public.habit_logs;
