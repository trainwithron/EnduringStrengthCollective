-- Withings integration (custom_shape_theming_idea.md / wearables_integration.md)
-- — reuses the exact wearable_connections/wearable_oauth_tokens/
-- wearable_daily_metrics infrastructure already proven for Oura
-- (0090_oura_wearable_integration.sql). No new tables: Withings is just
-- a second value for `provider`, and its one real metric (body weight)
-- is a second value for `metric_type`. Every existing RLS policy on
-- these three tables is already provider-agnostic (keyed on profile_id/
-- connection_id, not on which provider), so no policy changes are
-- needed here at all — only the two check constraints widen.

alter table public.wearable_connections drop constraint wearable_connections_provider_check;
alter table public.wearable_connections
  add constraint wearable_connections_provider_check
    check (provider in ('garmin', 'apple_health', 'google_health', 'oura', 'withings'));

-- Stored in lbs (converted from Withings' native kg at sync time) so it
-- reads consistently next to body_weight_logs.weight and every other
-- weight figure already shown in this app — never a second unit
-- convention introduced just for this one source.
alter table public.wearable_daily_metrics drop constraint wearable_daily_metrics_metric_type_check;
alter table public.wearable_daily_metrics
  add constraint wearable_daily_metrics_metric_type_check
    check (metric_type in ('steps', 'sleep_score', 'weight'));
