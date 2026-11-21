-- UNDO: step 213 (tape measurements). Removes the table and every measurement in it. Paste all of it into the Supabase SQL editor and run.

begin;

drop table if exists public.body_measurements;
drop function if exists public.body_measurements_touch();

commit;
