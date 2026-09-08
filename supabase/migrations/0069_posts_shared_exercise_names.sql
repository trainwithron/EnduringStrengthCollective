-- Lets the athlete who logged a workout choose exactly which lifts show
-- on their public share card, instead of the card always defaulting to
-- the top 3 by weight. Null means "no customization yet" — the share
-- page falls back to that same default, so every existing post keeps
-- rendering exactly as it did before this column existed.
alter table public.posts add column shared_exercise_names text[];
