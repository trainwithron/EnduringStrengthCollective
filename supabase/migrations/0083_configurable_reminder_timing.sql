-- Reminder timing needed a second shape beyond "N days before": some
-- coaches think in terms of a weekday ("remind me the Friday before"),
-- not a day count. suggestion_lead_days is kept as the value used when
-- suggestion_lead_mode = 'days_before'; suggestion_lead_weekday is used
-- when it's 'weekday_before' (0=Sun..6=Sat, JS Date.getDay() convention,
-- matching every other weekday column in this schema).
alter table public.coach_preferences
  add column suggestion_lead_mode text not null default 'days_before'
    check (suggestion_lead_mode in ('days_before', 'weekday_before')),
  add column suggestion_lead_weekday smallint
    check (suggestion_lead_weekday is null or suggestion_lead_weekday between 0 and 6);
