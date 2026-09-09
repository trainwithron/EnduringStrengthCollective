-- A short, coach-set label distinguishing groups that read similarly by
-- name alone (e.g. two groups both just "named after the client base")
-- — shown in the group switcher so a coach running several very
-- different groups (a hardcore bodybuilding group vs. a 60+ women's
-- group) can tell them apart at a glance while filtering/switching.
alter table public.groups add column focus_tag text;
