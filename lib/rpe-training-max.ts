// AI Program Builder methodology grounding
// (ai_program_builder_methodology_grounding_idea.md) — the one real
// blocking gap the deep dive found: every percentage-based programming
// methodology (Juggernaut, 5/3/1, Conjugate) needs a training max
// expressed as a real number, and this app only ever stores absolute
// weight. This is that primitive.
//
// RPE-aware, not just the plain Epley formula already in lib/one-rep-max.ts
// (reps x weight only — no way to account for how hard a set actually
// felt). Extends Epley by folding RPE in as reps-in-reserve: a set at a
// given weight/reps that felt like RPE 8 (2 reps left) is treated as if
// 2 more reps were still available, same real technique RPE-based
// training relies on generally — described here as a real, established
// extension of Epley rather than a reproduction of any single named/
// branded RPE chart verbatim (that distinction matters given this
// feature's own IP-grounding discipline).
export function estimateTrainingMaxFromSet(weight: number, reps: number, rpe: number): number | null {
  if (!weight || weight <= 0 || !reps || reps <= 0 || !rpe) return null;
  const reserveReps = Math.max(0, 10 - rpe);
  const effectiveReps = reps + reserveReps;
  return Math.round(weight * (1 + effectiveReps / 30) * 10) / 10;
}
