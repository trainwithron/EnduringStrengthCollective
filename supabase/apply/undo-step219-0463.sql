-- UNDO: step 219. Takes away what it added and puts the two changed functions back to exactly what they were. Section headers already made become plain day notes again
-- (their words are kept); the record of every-week swaps and any notice of one is deleted (the exercises stay as they are now: undo a swap first if it should go back). Paste all of it and run.

begin;

do $dup$
declare
  v_def text := replace(pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure), E'\r\n', E'\n');
  v_pairs constant text[][] := array[
    array['insert into public.workout_notes (workout_id, group_id, body, position, created_by, is_header)', 'insert into public.workout_notes (workout_id, group_id, body, position, created_by)'],
    array['select v_new_w, p_destination_group_id, body, position, v_by, is_header', 'select v_new_w, p_destination_group_id, body, position, v_by']
  ];
  i int;
begin
  if position('is_header' in v_def) = 0 then
    return; -- not changed
  end if;
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'duplicate_program does not hold "%" exactly once; NOTHING was changed.', v_pairs[i][1];
    end if;
  end loop;
  for i in 1 .. array_length(v_pairs, 1) loop
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end
$dup$;

do $kind$
declare
  v_def text := replace(pg_get_functiondef('public.notice_kind_of(text)'::regprocedure), E'\r\n', E'\n');
  v_line constant text := E'    when ''exercise_swap'' then ''client_activity''\n';
begin
  if position(v_line in v_def) = 0 then
    return; -- not changed
  end if;
  execute replace(v_def, v_line, '');
end
$kind$;

-- a notice already sent of the new type goes, so the type can come off the list
delete from public.notifications where type = 'exercise_swap';
do $types$
declare
  v_def text;
  v_keep text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null or position('''exercise_swap''' in v_def) = 0 then
    return;
  end if;
  select string_agg(quote_literal(m[1]), ', ' order by m[1]) into v_keep from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m where m[1] <> 'exercise_swap';
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', v_keep);
end
$types$;

drop function if exists public.undo_exercise_swap(uuid);
drop function if exists public.swap_exercise_every_week(uuid, text, text, boolean);
drop table if exists public.program_exercise_swaps;
drop function if exists public.business_client_tenure(uuid[]);
alter table public.workout_notes drop column if exists is_header;

commit;
