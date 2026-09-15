-- Hover rail widgets (hover_expand_rail_widgets_idea.md) — the Business
-- widget's "user picks their own top 3 metrics" preference. Same
-- per-coach row as the Home dashboard tiles (0148) and the Spot's
-- widget rail (0170), one more independent preference column rather
-- than a new table.
alter table public.coach_dashboard_layout
  add column business_widget_metrics text[] not null default '{}';
