-- Post-workout share card's background sourcing
-- (post_workout_card_v1_bevel_and_animation.md, Direction D) — a coach
-- picks between a built-in default rotation and a custom image (gotten
-- either by uploading their own photo, or by generating one externally
-- via a copy-paste AI prompt and uploading the result — both land as
-- the same "custom" mode, there's no separate "AI" storage state).
alter table public.organizations
  add column workout_card_background_mode text not null default 'default_rotation'
    check (workout_card_background_mode in ('default_rotation', 'custom')),
  add column workout_card_background_url text;
