-- AI Assistant Slice 4 — HRV + resting heart rate, needing no new OAuth
-- scope (the app already requests Oura's "daily" scope, which already
-- covers daily_readiness.contributors.hrv_balance/resting_heart_rate).
-- Same widening shape as migration 0146's own metric_type widening.
alter table public.wearable_daily_metrics drop constraint wearable_daily_metrics_metric_type_check;
alter table public.wearable_daily_metrics
  add constraint wearable_daily_metrics_metric_type_check
    check (metric_type in ('steps', 'sleep_score', 'weight', 'hrv_balance', 'resting_heart_rate'));
