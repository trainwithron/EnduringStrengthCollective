-- RELEASE BK (MOVE COACH RON'S OWN TRAINING INTO HIS PERSONAL SPACE; RUN AFTER HE HAS OPENED COACH RON (YOU) ONCE AND REMOVED THE PROGRAMS HE DOES NOT WANT): ONE paste. Steps 105 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 105: Coach Ron's remaining programs (and their workouts, exercises, logs, sessions and wellness check-ins) now live in his personal space and show in his own client view and on his own client profile in every organization. Nothing is deleted. To see what moved:  select tbl, count(*) from public.personal_space_move_log group by tbl order by tbl;
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BK (move Coach Ron's own training into his personal space; run AFTER he has opened Coach Ron (you) once and removed the programs he does not want), step 105: move Coach Ron's own training (his programs not yet removed, their workouts, his sessions, workout log and wellness check-ins in The Enduring Strength Collective) into his personal space; undoable
do $g105$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('Coach Ron''s profile exists', exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')),
      ('Coach Ron''s personal space exists (he has opened Coach Ron (you) once)', exists (select 1 from public.groups where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and organization_id is null)),
      ('there is exactly one group named The Enduring Strength Collective', (select count(*) from public.groups where name = 'The Enduring Strength Collective' and organization_id is not null) = 1),
      ('there is at least one program of Coach Ron''s there that has not been removed', exists (select 1 from public.programs p join public.groups g on g.id = p.group_id where g.name = 'The Enduring Strength Collective' and p.athlete_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and p.archived_at is null)),
      ('step 105 is not already applied (the move log is not there yet)', to_regclass('public.personal_space_move_log') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BK (move Coach Ron''s own training into his personal space; run AFTER he has opened Coach Ron (you) once and removed the programs he does not want), step 105 (move-ron-personal-training) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g105$;

-- Release BK: moves Coach Ron's OWN training (the programs made for him, their workouts and exercises, and his own logged sessions, workout log and wellness check-ins) out of "The Enduring Strength Collective"
-- into his PERSONAL SPACE, so it is one set that follows him into every organization. Only rows filed under his own id (136394ed-f108-4283-bcb7-310a1ac6cbc8) in that one group are touched.
-- Which programs move: every program made for him there that has not been removed (archived). A program he removed first stays where it is, and so does anything that belongs to it.
-- Left alone on purpose: the athlete session in Karina Ramirez's space, the check-in in the old "Ron Arnold" one-on-one space, and every other person's rows.
-- All or nothing. Every row moved is first written to personal_space_move_log (server-only), which is what the undo file reads.
-- After running, this shows what moved:  select tbl, count(*) from public.personal_space_move_log group by tbl order by tbl;

create table public.personal_space_move_log (
  id bigserial primary key,
  tbl text not null,
  row_id text not null,
  old_group_id uuid not null,
  new_group_id uuid not null,
  moved_at timestamptz not null default now()
);
alter table public.personal_space_move_log enable row level security;
revoke all on public.personal_space_move_log from anon, authenticated;

create function public.zz_move_rows(p_tbl text, p_ids uuid[], p_space uuid)
returns integer
language plpgsql
set search_path = public
as $f$
declare
  n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  execute format('insert into public.personal_space_move_log (tbl, row_id, old_group_id, new_group_id) select %L, id::text, group_id, $2 from public.%I where id = any($1)', p_tbl, p_tbl) using p_ids, p_space;
  execute format('update public.%I set group_id = $2 where id = any($1)', p_tbl) using p_ids, p_space;
  get diagnostics n = row_count;
  return n;
end;
$f$;

do $move$
declare
  v_ron constant uuid := '136394ed-f108-4283-bcb7-310a1ac6cbc8';
  v_space uuid;
  v_esc uuid;
  v_programs uuid[];
  v_workouts uuid[];
  v_lines uuid[];
  v_sessions uuid[];
begin
  select g.id into v_space from public.groups g where g.created_by = v_ron and g.organization_id is null;
  if v_space is null then
    raise exception 'Coach Ron''s personal space does not exist yet. Open "Coach Ron (you)" in the Clients list once, then run this again.';
  end if;
  if (select count(*) from public.groups g where g.name = 'The Enduring Strength Collective' and g.organization_id is not null) <> 1 then
    raise exception 'Expected exactly one group named The Enduring Strength Collective.';
  end if;
  select g.id into v_esc from public.groups g where g.name = 'The Enduring Strength Collective' and g.organization_id is not null;

  v_programs := array(select p.id from public.programs p where p.athlete_id = v_ron and p.group_id = v_esc and p.archived_at is null);
  if cardinality(v_programs) = 0 then
    raise exception 'There is no program of Coach Ron''s left to move in The Enduring Strength Collective.';
  end if;
  v_workouts := array(select w.id from public.workouts w where w.program_id = any (v_programs) and w.group_id = v_esc);
  v_lines := array(select e.id from public.group_workout_exercises e where e.workout_id = any (v_workouts) and e.group_id = v_esc);
  -- His own sessions in that group whose workout is one of the moved programs (or that belong to no program).
  v_sessions := array(select s.id from public.athlete_sessions s where s.athlete_id = v_ron and s.group_id = v_esc and (s.workout_id is null or s.workout_id = any (v_workouts)));

  perform public.zz_move_rows('programs', v_programs, v_space);
  perform public.zz_move_rows('workouts', v_workouts, v_space);
  perform public.zz_move_rows('group_workout_exercises', v_lines, v_space);
  perform public.zz_move_rows('workout_notes', array(select n.id from public.workout_notes n where n.workout_id = any (v_workouts) and n.group_id = v_esc), v_space);
  -- workout_assignments has no id column: a row is named by its workout and person.
  insert into public.personal_space_move_log (tbl, row_id, old_group_id, new_group_id)
    select 'workout_assignments', a.workout_id::text || ':' || a.athlete_id::text, a.group_id, v_space from public.workout_assignments a where a.workout_id = any (v_workouts) and a.group_id = v_esc;
  update public.workout_assignments set group_id = v_space where workout_id = any (v_workouts) and group_id = v_esc;
  perform public.zz_move_rows('exercise_progressions', array(select x.id from public.exercise_progressions x where x.program_id = any (v_programs) and x.group_id = v_esc), v_space);
  perform public.zz_move_rows('athlete_exercise_overrides', array(select o.id from public.athlete_exercise_overrides o where o.group_workout_exercise_id = any (v_lines) and o.group_id = v_esc), v_space);
  perform public.zz_move_rows('athlete_sessions', v_sessions, v_space);
  perform public.zz_move_rows('workout_logs', array(select l.id from public.workout_logs l where l.athlete_id = v_ron and l.group_id = v_esc and (l.session_id = any (v_sessions) or (l.session_id is null and l.workout_id = any (v_workouts)))), v_space);
  perform public.zz_move_rows('session_coach_notes', array(select c.id from public.session_coach_notes c where c.session_id = any (v_sessions) and c.group_id = v_esc), v_space);
  perform public.zz_move_rows('session_pattern_checks', array(select c.id from public.session_pattern_checks c where c.session_id = any (v_sessions) and c.group_id = v_esc), v_space);
  perform public.zz_move_rows('wellness_checkins', array(select w.id from public.wellness_checkins w where w.athlete_id = v_ron and w.group_id = v_esc), v_space);
end;
$move$;

drop function public.zz_move_rows(text, uuid[], uuid);

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 105 (move-ron-personal-training)' as step, 'move Coach Ron''s own training' as what, not ((to_regclass('public.personal_space_move_log') is null)) as in_place
) as result order by step;
