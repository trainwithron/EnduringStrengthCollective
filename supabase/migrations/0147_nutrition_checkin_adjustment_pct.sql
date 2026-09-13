-- Coach-adjustable "how big should a planned calorie change be" dial,
-- 1-15% (nutrition_checkin_engine_scoping.md's previously-deferred
-- "macro slider," resolved 2026-09-13). Applies to the reverse-diet
-- increase and the fat-loss stall cut; the too-rapid-loss safety
-- correction stays fixed regardless (see lib/nutrition-checkin.ts).
-- Default 5 matches the engine's own DEFAULT_ADJUSTMENT_PCT.

alter table public.nutrition_checkins
  add column adjustment_pct numeric not null default 5
    check (adjustment_pct >= 1 and adjustment_pct <= 15);

alter table public.nutrition_checkin_suggestions
  add column adjustment_pct numeric not null default 5
    check (adjustment_pct >= 1 and adjustment_pct <= 15);
