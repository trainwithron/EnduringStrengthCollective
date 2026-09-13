// AI Assistant Slice 3 — "Move them back" (ai_assistant_opus_deep_dive_
// findings.md). Cheapest signal in the whole vision: an athlete with a
// per-exercise override (athlete_exercise_overrides — a name-swap only,
// same set/rep scheme as the template per workout-overview-data.ts's own
// comment) may have outgrown the substitute. Reuses the RULE Double
// Progression already generates prescriptions by (lib/progression-
// models.ts's generateDoubleProgression resets reps to the floor and
// bumps weight once repMax is hit) — this reads that same ceiling
// condition off real logged history instead of generating a future
// target. The CTA is the "Reset to default" button client-slot-row.tsx
// already has; this just tells the coach when it's worth pressing.
export function hasReachedProgressionCeiling(
  mostRecentLoggedReps: number | null,
  repMax: number | null
): boolean {
  if (repMax == null || mostRecentLoggedReps == null) return false;
  return mostRecentLoggedReps >= repMax;
}
