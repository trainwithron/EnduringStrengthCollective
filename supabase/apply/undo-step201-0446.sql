-- UNDO step 201 (Upload nutrition history): the food_source check goes back to the 0300 list. It refuses while any imported food is still stored (the old check would not hold);
-- remove those first with "Remove imported history" on each client's Nutrition tab (or delete the rows where food_source = 'import'), then run this again.
do $$
begin
  if exists (select 1 from public.food_log_entries where food_source = 'import') then
    raise exception 'Imported nutrition history is still stored. Remove it first, then run this undo again.';
  end if;
  alter table public.food_log_entries drop constraint if exists food_log_entries_food_source_check;
  alter table public.food_log_entries add constraint food_log_entries_food_source_check
    check (food_source is null or food_source in ('usda', 'custom', 'saved_meal', 'barcode', 'ai', 'plan'));
end $$;
