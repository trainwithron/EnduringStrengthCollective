// Phase 1 of the gamified-logging thread — the obstacle/unlock mechanic.
// A set's prescribed goal (today's program target, or the correlating-
// week weight suggestion) starts visually blocked by a simple lock icon.
// Hitting/beating it defeats the obstacle for the REST of that
// exercise's sets, not just the one that cleared it — matching how
// straight-set training actually works (clearing the weight once really
// does mean the remaining sets at it are basically cleared too).
//
// "Smashing it" is either of two independent paths, either qualifies:
//   (a) a genuine PR at that exact weight/rep combo — weight, rep, or
//       single-set volume, whichever is highest against real history
//   (b) simply meeting today's prescribed target, even if it isn't an
//       all-time first
// A miss does nothing — the obstacle stays up, carries to the next set,
// and (deliberately) a below-goal result never partially unlocks
// anything, even if that lower number has real history behind it. See
// custom_shape_theming_idea.md's "obstacle/unlock mechanic" section for
// the full resolved design this ports.

export interface PriorBestSet {
  weight: number | null;
  reps: number | null;
}

export interface PriorBest {
  maxWeight: number | null;
  maxReps: number | null;
  maxVolume: number | null;
}

export function computePriorBest(history: PriorBestSet[]): PriorBest {
  let maxWeight: number | null = null;
  let maxReps: number | null = null;
  let maxVolume: number | null = null;
  for (const h of history) {
    if (h.weight == null || h.reps == null) continue;
    if (maxWeight == null || h.weight > maxWeight) maxWeight = h.weight;
    if (maxReps == null || h.reps > maxReps) maxReps = h.reps;
    const volume = h.weight * h.reps;
    if (maxVolume == null || volume > maxVolume) maxVolume = volume;
  }
  return { maxWeight, maxReps, maxVolume };
}

// Any one of the three counts — a genuinely new heaviest weight, a
// genuinely new highest rep count, or a genuinely new single-set volume
// (weight x reps) all read as "smashed it" for this ambient, motivational
// mechanic. This is deliberately more generous than the whole-workout
// PR check (weight-only) used at session completion — that one still
// runs unchanged for the share card/feed; this is a different, faster-
// firing signal meant to feel achievable set-to-set.
export function isGenuinePr(weight: number, reps: number, prior: PriorBest): boolean {
  const volume = weight * reps;
  const isWeightPr = prior.maxWeight == null || weight > prior.maxWeight;
  const isRepsPr = prior.maxReps == null || reps > prior.maxReps;
  const isVolumePr = prior.maxVolume == null || volume > prior.maxVolume;
  return isWeightPr || isRepsPr || isVolumePr;
}

// No target at all (freeform/manual logging with nothing prescribed)
// means this path simply never applies — the PR path is still fully
// available on its own.
export function meetsPrescribedTarget(
  weight: number,
  reps: number,
  targetWeight: number | null,
  targetReps: number | null
): boolean {
  if (targetWeight == null || targetReps == null) return false;
  return weight >= targetWeight && reps >= targetReps;
}

export function isObstacleCleared(
  weight: number | null,
  reps: number | null,
  targetWeight: number | null,
  targetReps: number | null,
  prior: PriorBest
): boolean {
  if (weight == null || reps == null) return false;
  return (
    meetsPrescribedTarget(weight, reps, targetWeight, targetReps) || isGenuinePr(weight, reps, prior)
  );
}

export interface ObstacleSetInput {
  weight: number | null;
  reps: number | null;
  targetWeight: number | null;
  targetReps: number | null;
}

// Once any one set in the exercise clears it, the whole exercise reads
// as unlocked — this is meant to be re-evaluated against the exercise's
// current set of sets on every render, not tracked as separate stored
// state, so it self-corrects if a cleared value is edited back down.
export function isExerciseUnlocked(sets: ObstacleSetInput[], prior: PriorBest): boolean {
  return sets.some((s) => isObstacleCleared(s.weight, s.reps, s.targetWeight, s.targetReps, prior));
}
