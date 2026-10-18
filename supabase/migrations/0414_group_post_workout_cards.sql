-- Release CS1: a group setting, "Post-workout cards and PR notices".
-- null (the default for every group) means: OFF for a team-sport group (team_mode), ON for every other group; a coach's choice is stored as true or false. Adds one nullable column and nothing else; no group
-- changes behaviour by this file alone, and the app tolerates the column being missing. Re-runnable.
alter table public.groups add column if not exists post_workout_cards boolean;
comment on column public.groups.post_workout_cards is 'Null = default (off for a team-sport group, on otherwise). Controls the feed card, the share card and record notices after a workout, and the weekly milestone notices to athletes.';
