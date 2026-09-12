-- Real per-org/per-client on/off preference for the gamified-logging
-- thread (obstacle/unlock, and everything else in that same thread) —
-- same reasoning already established for optional RPE/RIR fields: a
-- real segment of any group just wants to log sets/reps and move on,
-- and forcing extra visual mechanics on them is its own friction.
-- Defaults on so the feature is actually discoverable/testable once
-- shipped; a coach who doesn't want it can turn it off per group.
alter table public.groups
  add column gamification_enabled boolean not null default true;
