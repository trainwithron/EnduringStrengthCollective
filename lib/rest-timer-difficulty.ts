// Shared escalating-difficulty engine for the rest-timer mini-game
// library (custom_shape_theming_idea.md, Phase 4) — every game reskins
// this one ramp rather than tuning six separate curves. Ron's resolved
// design: no flat "lockout buffer" subtracted from play time — the
// difficulty ramp itself IS the transition cue. A game runs for the
// full rest window; difficulty escalates as the window closes so a
// player naturally dies somewhere in the back stretch, right around
// when they should be putting the phone down anyway. A hard cutoff at
// the window's end is a separate backstop, applied by the caller
// (rest-timer-bar.tsx already owns the real countdown) — nobody can
// out-survive it no matter how good they are.

// Below this many seconds of rest, no mini-game renders at all — the
// existing plain countdown is all that shows. Reasoning (Ron's own,
// 2026-09-13): a real game needs a real ~20-25s+ window to feel like a
// game rather than a flash on screen; 45s is the sweet spot that still
// covers common 45-60s accessory-work rest prescriptions.
export const MIN_REST_SECONDS_FOR_GAME = 45;

// 0 at game start, 1 at the hard cutoff (the rest period's own end).
export function computeDifficultyProgress(elapsedMs: number, totalDurationMs: number): number {
  if (totalDurationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / totalDurationMs));
}

// Eases in (progress^1.5) so difficulty stays gentle early and
// escalates more sharply as the window closes — most players should
// die somewhere in the back third of the window, not at the very start,
// and shouldn't need to survive the entire window to feel challenged.
export function computeDifficultyMultiplier(progress: number, start: number, max: number): number {
  const eased = Math.pow(progress, 1.5);
  return start + (max - start) * eased;
}
