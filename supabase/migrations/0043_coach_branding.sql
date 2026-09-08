-- Per-coach desktop branding: button shape + accent/background colors.
-- Lives on the same one-row-per-coach table as the existing suggestion
-- preferences (coach_preferences) rather than a new table.
alter table public.coach_preferences
  add column button_shape text not null default 'sharp'
    check (button_shape in ('sharp', 'rounded', 'pill')),
  add column accent_color text not null default '#C4622D',
  add column background_color text not null default '#1C1B1A';
