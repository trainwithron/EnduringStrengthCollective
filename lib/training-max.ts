// ONE estimate of a training max / one-rep max, used everywhere (the stored training max in the database uses the same arithmetic, see recompute_training_max in the database).
// Epley with the reps left in reserve added: a set at RPE 8 had 2 reps left, so it counts as 2 more reps. A set with no RPE entered is treated as RPE 9 (1 rep left), the same assumption the database makes.
// Only sets of 1 to 8 reps are trusted (the estimate gets unreliable as reps climb; a set of 15 says little about a one-rep max).

export const MAX_ESTIMATE_REPS = 8;
export const ASSUMED_RPE = 9;

export function estimateTrainingMax(weight: number, reps: number, rpe?: number | null): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps < 1 || reps > MAX_ESTIMATE_REPS) return null;
  const effectiveRpe = rpe != null && Number.isFinite(rpe) && rpe >= 1 && rpe <= 10 ? rpe : ASSUMED_RPE;
  const reserve = Math.max(0, 10 - effectiveRpe);
  return Math.round(weight * (1 + (reps + reserve) / 30) * 10) / 10;
}

export const TRAINING_MAX_REPS_NOTE = `Use a set of ${MAX_ESTIMATE_REPS} reps or fewer: an estimate from more reps is not reliable.`;
