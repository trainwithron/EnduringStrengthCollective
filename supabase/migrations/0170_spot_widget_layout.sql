-- "The Spot" (coach_only_widget_hub_the_spot.md) — the coach-only widget
-- rail shown on top of the true-mirror View-As-Client screen. Reuses the
-- existing per-coach dashboard-customization row (0148_dashboard_
-- customization.sql) rather than a new table: same shape (hidden/ordered
-- keys, one row per coach), just a second, independent set of keys for a
-- different customizable surface (the Spot's rail vs. the Home
-- dashboard's own bento tiles).
alter table public.coach_dashboard_layout
  add column spot_hidden_widgets text[] not null default '{}',
  add column spot_widget_order text[] not null default '{}';
