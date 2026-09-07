alter table public.exercise_library
  add column category text
    check (category is null or category in ('Push','Pull','Legs','Core','Full Body','Cardio','Mobility'));
