-- Peaking & Tapering, part 1 (goal_date_aware_nutrition_and_programming_idea.md)
-- — the shared event_window object's last missing field. A client
-- peaking for a weight-class meet (powerlifting/strongman) while also
-- cutting weight is a real, common conflict with no real evidence base
-- to automate — surfaced as a coach-facing flag, not a resolved
-- algorithm.
alter table public.client_goals add column weight_class_flag boolean not null default false;
