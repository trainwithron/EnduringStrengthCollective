alter table public.programs
  add column start_date date,
  add column training_days smallint[]
    constraint programs_training_days_valid
    check (training_days is null or training_days <@ array[0,1,2,3,4,5,6]::smallint[]);
