-- nutrition_checkins stored only the DETECTED diet_archetype (keto/
-- carnivore/standard), not the coach's actual free-text input ("keto,
-- no dairy") — needed to prefill the Weekly Check-In panel's dietary-
-- restrictions field the next time it's opened for this client.
alter table public.nutrition_checkins
  add column dietary_restrictions text not null default '';
