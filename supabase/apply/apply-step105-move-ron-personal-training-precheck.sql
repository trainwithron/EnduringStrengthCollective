-- STEP 105 (PRECHECK, run first, changes nothing): move Coach Ron's own training (his programs not yet removed, their workouts, his sessions, workout log and wellness check-ins in The Enduring Strength Collective) into his personal space; undoable
--
-- !! A one-time data change for Coach Ron's OWN rows only. Run it after Coach Ron has opened Coach Ron (you) in the Clients list once (that creates his personal space) and after he has removed the programs he does not want. It stops with nothing changed if the space does not exist yet.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('Coach Ron''s profile exists',
      exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')),
    ('Coach Ron''s personal space exists (he has opened Coach Ron (you) once)',
      exists (select 1 from public.groups where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and organization_id is null)),
    ('there is exactly one group named The Enduring Strength Collective',
      (select count(*) from public.groups where name = 'The Enduring Strength Collective' and organization_id is not null) = 1),
    ('there is at least one program of Coach Ron''s there that has not been removed',
      exists (select 1 from public.programs p join public.groups g on g.id = p.group_id where g.name = 'The Enduring Strength Collective' and p.athlete_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and p.archived_at is null)),
    ('step 105 is not already applied (the move log is not there yet)',
      to_regclass('public.personal_space_move_log') is null)
) as checks(check_name, ok);
