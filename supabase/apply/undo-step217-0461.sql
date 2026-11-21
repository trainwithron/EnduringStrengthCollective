-- UNDO: step 217. team_sheet_save takes only 'xlsx' and 'csv' again (its body back to exactly what it was), and so does team_sheet_batches.source. Uploads already saved as "photo"
-- stay as they are (the check is put back NOT VALID when there are any, so nothing saved is changed or lost). Paste all of it into the Supabase SQL editor and run.

begin;

do $undo$
declare
  v_def text := replace(pg_get_functiondef('public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean)'::regprocedure), E'\r\n', E'\n');
  v_new constant text := 'if p_source is null or p_source not in (''xlsx'', ''csv'', ''photo'') then';
  v_old constant text := 'if p_source is null or p_source not in (''xlsx'', ''csv'') then';
begin
  if position(v_new in v_def) = 0 then
    return; -- not patched
  end if;
  if (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1 then
    raise exception 'team_sheet_save holds the photo source check more than once; NOTHING was changed.';
  end if;
  execute replace(v_def, v_new, v_old);
end
$undo$;

alter table public.team_sheet_batches drop constraint if exists team_sheet_batches_source_check;
do $c$
begin
  if exists (select 1 from public.team_sheet_batches where source = 'photo') then
    alter table public.team_sheet_batches add constraint team_sheet_batches_source_check check (source = any (array['xlsx'::text, 'csv'::text])) not valid;
  else
    alter table public.team_sheet_batches add constraint team_sheet_batches_source_check check (source = any (array['xlsx'::text, 'csv'::text]));
  end if;
end
$c$;

commit;
