-- Extends coach desktop branding (0043) with a text color and a
-- curated short list of display/body fonts.
alter table public.coach_preferences
  add column text_color text not null default '#EDE8E0',
  add column font_display text not null default 'Barlow Condensed'
    check (font_display in ('Barlow Condensed', 'Oswald', 'Bebas Neue', 'Anton')),
  add column font_body text not null default 'Inter'
    check (font_body in ('Inter', 'Roboto', 'Work Sans', 'Nunito Sans'));
