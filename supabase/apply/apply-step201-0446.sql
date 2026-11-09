-- PASTE: step 201 (Upload nutrition history). Paste all of this into the Supabase SQL editor and Run. The last result is 2 rows; every one should say true.

begin;

-- Nutrition history a coach brings in from another app (Cronometer, MyFitnessPal, MacroFactor) is stored as food with food_source = 'import': shown in the client's history and
-- charts, never counted as the client logging. This only allows 'import' in the food_source check; nothing existing is changed or removed, and who can read or write a food log
-- is unchanged. Re-running is safe.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'food_log_entries_food_source_check'
      and conrelid = 'public.food_log_entries'::regclass
      and pg_get_constraintdef(oid) like '%''import''%'
  ) then
    alter table public.food_log_entries drop constraint if exists food_log_entries_food_source_check;
    alter table public.food_log_entries add constraint food_log_entries_food_source_check
      check (food_source is null or food_source in ('usda', 'custom', 'saved_meal', 'barcode', 'ai', 'plan', 'import'));
  end if;
end $$;

commit;

select 'food_source allows import' as check_name,
  exists (select 1 from pg_constraint where conname = 'food_log_entries_food_source_check' and conrelid = 'public.food_log_entries'::regclass and pg_get_constraintdef(oid) like '%''import''%') as ok
union all select 'food_source still allows every earlier value',
  exists (select 1 from pg_constraint where conname = 'food_log_entries_food_source_check' and conrelid = 'public.food_log_entries'::regclass
    and pg_get_constraintdef(oid) like '%''usda''%' and pg_get_constraintdef(oid) like '%''custom''%' and pg_get_constraintdef(oid) like '%''saved_meal''%'
    and pg_get_constraintdef(oid) like '%''barcode''%' and pg_get_constraintdef(oid) like '%''ai''%' and pg_get_constraintdef(oid) like '%''plan''%');
