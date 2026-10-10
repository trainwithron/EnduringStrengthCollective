-- STEP 79 (PRECHECK, run first, changes nothing): 0333 A one-on-one space keeps being one: its programs must be for its client, group-only features are refused there, and it cannot be turned into another kind of space
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0333 is not already applied (one_on_one_athlete does not exist yet)',
      to_regprocedure('public.one_on_one_athlete(uuid)') is null),
    ('0332 is applied (step 78): is_one_on_one_group exists',
      to_regprocedure('public.is_one_on_one_group(uuid)') is not null),
    ('guard_group_columns is the live 0273 text (so replacing it loses nothing)',
      (select md5(prosrc) from pg_proc where proname = 'guard_group_columns' and pronamespace = 'public'::regnamespace) = 'cea7182706ddecddad86da2d710c6b4e'),
    ('move_client_to_group is the live text, or the 0106 text (they differ only in a comment), so replacing it loses nothing',
      (select md5(prosrc) from pg_proc where proname = 'move_client_to_group' and pronamespace = 'public'::regnamespace) in ('d22c15df46986728f97a0b9e445b87b1', '3425f2a00e3b4e44cba31f5213ea5f8c')),
    ('the tables the new rules sit on exist',
      to_regclass('public.group_sessions') is not null and to_regclass('public.group_invites') is not null and to_regclass('public.team_games') is not null and to_regclass('public.team_practice_schedules') is not null and to_regclass('public.group_stat_fields') is not null)
) as checks(check_name, ok);
