// Team Pulse — one score per real team-mode group, never blended across
// groups or across 1-on-1 clients (coach_dashboard_redesign_scoping.md).
// Equal-weighted average of three already-shipped signals: average
// readiness today, % of roster active this week, 7-day habit compliance.
// A component with genuinely no data (not "0%", just never measured)
// drops out of the average entirely — a team that hasn't adopted
// check-ins/habits yet shouldn't read as unhealthy for a reason
// unrelated to actual health.

export interface TeamPulseInputs {
  avgReadinessToday: number | null; // 1-5 scale, or null if no check-ins today
  pctActiveThisWeek: number | null; // 0-100, or null if the group has no roster at all
  habitCompliancePct: number | null; // 0-100, or null if nothing was ever due
}

// Readiness is on a 1-5 scale; the other two are already 0-100 — rescale
// readiness onto the same 0-100 basis before averaging so one component
// doesn't silently dominate.
function readinessToScore(avgReadiness: number): number {
  return ((avgReadiness - 1) / 4) * 100;
}

export function computeTeamPulse(inputs: TeamPulseInputs): number | null {
  const components: number[] = [];
  if (inputs.avgReadinessToday != null) components.push(readinessToScore(inputs.avgReadinessToday));
  if (inputs.pctActiveThisWeek != null) components.push(inputs.pctActiveThisWeek);
  if (inputs.habitCompliancePct != null) components.push(inputs.habitCompliancePct);

  if (components.length === 0) return null;
  return Math.round(components.reduce((sum, v) => sum + v, 0) / components.length);
}
