-- UNDO: step 224. Only if it must be taken back: removes the packaged-foods search and table (and every product loaded into it; the import batches can load them again).
-- Their load markers in usda_load_batches are removed too, so a later load is not skipped. Nothing else is touched. Last result: one row, all true.

begin;

drop function if exists public.search_branded_foods(text[], integer);
drop table if exists public.usda_branded_foods;
delete from public.usda_load_batches where name like 'branded-%';

commit;

-- Check: one row, all true.
select
  to_regclass('public.usda_branded_foods') is null as branded_table_gone,
  to_regprocedure('public.search_branded_foods(text[], integer)') is null as search_function_gone,
  not exists (select 1 from public.usda_load_batches where name like 'branded-%') as branded_markers_gone;
