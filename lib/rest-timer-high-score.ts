// Per-device, per-browser Snake high score for the rest-timer mini-game
// — a real "hyper-casual" hook (a personal best to beat), same
// low-stakes localStorage convention already used by lib/card-size.ts.
// Deliberately not synced to the database: this is a throwaway arcade
// score attached to dead time between sets, not real athlete data.
const STORAGE_KEY = "esc-rest-timer-snake-high-score";

export function readSnakeHighScore(): number {
  if (typeof window === "undefined") return 0;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const n = stored ? Number(stored) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Returns the score that should now be shown as the high score (either
// the new one, if it's a real improvement, or the previous one
// unchanged) — the caller doesn't need its own comparison logic.
export function recordSnakeScore(score: number): number {
  const previous = readSnakeHighScore();
  if (score <= previous) return previous;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(score));
    } catch {
      // Private-browsing / storage-blocked — the score just won't
      // persist past this session, no different from not having a
      // high-score feature at all.
    }
  }
  return score;
}
