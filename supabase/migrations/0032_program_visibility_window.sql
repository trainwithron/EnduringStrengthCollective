alter table public.programs
  add column visibility_window text not null default 'day'
    check (visibility_window in ('day','week','month','full'));
