-- A coach's own words for a client who has just finished a workout, shown on the client's post-workout card
-- ("From your coach"). Optional; without it the card uses a warm default written in the coach's voice.
-- Added to coach_profiles, which the coach already edits from their Home.
alter table public.coach_profiles
  add column if not exists completion_message text
    check (completion_message is null or length(completion_message) <= 280);
