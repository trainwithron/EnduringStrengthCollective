-- AI Assistant Slice 5 — the athlete free-text reflection field
-- (ai_assistant_opus_deep_dive_findings.md, "highest-leverage single
-- schema change" — unblocks both the deferred injury-keyword flag and
-- sentiment-trajectory detection). Delivery mechanism is Ron's own,
-- from life_impact_reflection_prompt_idea.md: piggyback on the existing
-- wellness check-in rather than a new surface, occasional cadence, a
-- rotating prompt bank. Nullable/additive — every existing check-in row
-- is unaffected.
alter table public.wellness_checkins
  add column life_impact_prompt text,
  add column life_impact_note text;
