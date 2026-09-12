// Milestone Celebrations, piece #2 (milestone_celebration_system_scoping.md)
// — a specific lift's estimated 1RM crossing a bodyweight-multiple
// threshold ("you just deadlifted 2x your bodyweight"). A pure threshold
// crossing, not a trend/window computation — fires the same way PR
// detection already does (at workout-completion time), no cron or new
// schema needed.

export const BODYWEIGHT_MULTIPLES = [1, 1.5, 2, 2.5, 3] as const;

export interface RelativeStrengthMilestone {
  multiple: number;
}

// Returns the HIGHEST newly-crossed multiple, or null if nothing new was
// crossed (already cleared it before, or bodyweight is unknown). Checked
// highest-first so a big jump (e.g. from under 1x straight past 2x) is
// credited at its real ceiling, not the first/lowest threshold it also
// happens to clear.
export function computeRelativeStrengthMilestone(
  currentEst1Rm: number,
  priorBestEst1Rm: number | null,
  bodyweight: number | null
): RelativeStrengthMilestone | null {
  if (bodyweight == null || bodyweight <= 0) return null;
  const descending = [...BODYWEIGHT_MULTIPLES].sort((a, b) => b - a);
  for (const multiple of descending) {
    const threshold = multiple * bodyweight;
    const clearsNow = currentEst1Rm >= threshold;
    const clearedBefore = priorBestEst1Rm != null && priorBestEst1Rm >= threshold;
    if (clearsNow && !clearedBefore) {
      return { multiple };
    }
  }
  return null;
}
