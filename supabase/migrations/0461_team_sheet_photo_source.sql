-- Step 217 (Ron, Nov 20: a team sheet read from a photo of the printed sheet). A save that came from a photo is recorded as what it is: "photo", beside "xlsx" and "csv".
--   1. team_sheet_batches.source may be 'photo' (the list of saved uploads shows "Photo").
--   2. team_sheet_save accepts p_source 'photo'. Patched into the LIVE function: its one source check is found exactly once, or nothing changes; already patched: skipped.
-- Nothing else in the function changes, and nothing else is stored: the photo itself is never kept (it is read and dropped).
-- Re-running is safe.

alter table public.team_sheet_batches drop constraint if exists team_sheet_batches_source_check;
alter table public.team_sheet_batches add constraint team_sheet_batches_source_check check (source = any (array['xlsx'::text, 'csv'::text, 'photo'::text]));

do $photo$
declare
  v_def text := replace(pg_get_functiondef('public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean)'::regprocedure), E'\r\n', E'\n');
  v_old constant text := 'if p_source is null or p_source not in (''xlsx'', ''csv'') then';
  v_new constant text := 'if p_source is null or p_source not in (''xlsx'', ''csv'', ''photo'') then';
begin
  if position(v_new in v_def) > 0 then
    return; -- already patched (re-run)
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'team_sheet_save does not hold its source check exactly once; NOTHING was changed.';
  end if;
  execute replace(v_def, v_old, v_new);
end
$photo$;
