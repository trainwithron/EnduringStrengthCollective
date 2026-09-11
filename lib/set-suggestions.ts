// Correlating-week weight suggestion — NOT "show last session's number."
// Looks back through real logged history for the most recent PAST set on
// the same exercise whose own TARGET rep count (ideally target RPE/RIR
// too) matches this set's target, and suggests that session's real
// logged weight — so an undulating cycle correctly reaches back past the
// intervening different-rep-target weeks to the last time this exact rep
// scheme was actually trained, rather than the immediately prior session.

export interface LoggedSetForSuggestion {
  loggedAt: string; // ISO — used only to pick the most recent match
  weight: number | null;
  targetReps: number | null;
  targetRpe: number | null;
  targetRir: number | null;
}

// Most recent entry whose target reps match exactly, preferring one whose
// target RPE/RIR also match (when the current set actually has an
// RPE/RIR target to compare against) over one that only matches on reps.
export function findCorrelatingWeightSuggestion(
  history: LoggedSetForSuggestion[],
  currentTargetReps: number | null,
  currentTargetRpe: number | null = null,
  currentTargetRir: number | null = null
): number | null {
  if (currentTargetReps == null) return null;

  const repMatches = history.filter(
    (h) => h.weight != null && h.targetReps === currentTargetReps
  );
  if (repMatches.length === 0) return null;

  const wantsRpeOrRir = currentTargetRpe != null || currentTargetRir != null;
  if (wantsRpeOrRir) {
    const tightMatches = repMatches.filter(
      (h) =>
        (currentTargetRpe == null || h.targetRpe === currentTargetRpe) &&
        (currentTargetRir == null || h.targetRir === currentTargetRir)
    );
    if (tightMatches.length > 0) return mostRecent(tightMatches).weight;
  }

  return mostRecent(repMatches).weight;
}

function mostRecent(entries: LoggedSetForSuggestion[]): LoggedSetForSuggestion {
  return entries.reduce((latest, e) => (e.loggedAt > latest.loggedAt ? e : latest));
}

// Reconciles the history-based suggestion above with an explicit
// coach/generator-set target_weight for THIS set (e.g. a linear
// progression's computed next step, or a manually typed number). The
// explicit target wins only when it represents real forward progression
// beyond what history shows — a linear program's "105" beats a stale
// "100" from last time at this same rep target — but a lower or equal
// explicit number (a generator's percentage guess for a wave's repeat
// week, for instance) never overrides genuine logged history, since the
// real number an athlete actually lifted is more trustworthy than a
// guess once one exists.
export function resolveWeightSuggestion(
  correlatingMatch: number | null,
  explicitTarget: number | null
): number | null {
  if (explicitTarget != null && (correlatingMatch == null || explicitTarget > correlatingMatch)) {
    return explicitTarget;
  }
  return correlatingMatch ?? explicitTarget;
}
