-- Nutrition history a coach brings in from another app (Ron, Nov 9: "Upload nutrition history" on a client's Nutrition tab, from a Cronometer, MyFitnessPal or MacroFactor export).
-- The rows go into food_log_entries like any other food, marked food_source = 'import', so the day views and charts show what the client ate. The app never counts an imported
-- row as the client logging (the weekly check-in's days logged, the coach's This week table, the 7-day food view, the phase review, recent foods: lib/imported-food.ts).
-- The only change here is allowing 'import' in the food_source check (migration 0300 allowed usda, custom, saved_meal, barcode, ai, plan). Who can read or write a food log is
-- unchanged: the coach's upload is written by the server after it checks the coach and the client (app/api/clients/nutrition-history). Re-runnable.

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
