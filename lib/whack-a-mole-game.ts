// Whack-a-mole reaction game, one of the rest-timer mini-game library
// (Phase 4, custom_shape_theming_idea.md) — flagged in the original spec
// as an especially good fit for the 45s-minimum short window since it's
// inherently short-burst. Unlike the collision-based games in this
// library, "death" here is a miss limit: enough moles expiring unhit
// ends the round — a natural fit since escalating spawn rate / shorter
// mole-up time directly drives more misses as the window closes.

export interface Mole {
  holeIndex: number;
  expiresAtMs: number;
}

export interface WhackAMoleState {
  moles: Mole[];
  score: number;
  misses: number;
  status: "playing" | "over";
  elapsedMs: number;
  lastSpawnMs: number;
}

export const HOLE_COUNT = 9;
export const MAX_MISSES = 5;

export function createWhackAMoleGame(): WhackAMoleState {
  return { moles: [], score: 0, misses: 0, status: "playing", elapsedMs: 0, lastSpawnMs: -Infinity };
}

// `spawnIntervalMs` (time between new moles) and `moleUpMs` (how long a
// mole stays up before it counts as a miss) are both driven by the
// caller's own difficulty multiplier — a shorter interval and a shorter
// mole-up window, closer to the end of the rest window, is what makes
// this harder as the window closes.
export function stepWhackAMoleTick(
  state: WhackAMoleState,
  tickMs: number,
  spawnIntervalMs: number,
  moleUpMs: number,
  rng: () => number = Math.random
): WhackAMoleState {
  if (state.status === "over") return state;

  const elapsedMs = state.elapsedMs + tickMs;
  const stillUp = state.moles.filter((m) => m.expiresAtMs > elapsedMs);
  const expiredCount = state.moles.length - stillUp.length;
  const misses = state.misses + expiredCount;

  // Keep the same array reference when nothing actually expired — most
  // ticks land in the gap between spawns with nothing changing at all,
  // and the caller (whack-a-mole-mini-game.tsx) relies on this to skip
  // a React re-render via reference equality instead of forcing one on
  // every single tick the way the old setInterval+setState loop did.
  let moles = expiredCount > 0 ? stillUp : state.moles;
  let lastSpawnMs = state.lastSpawnMs;
  if (elapsedMs - lastSpawnMs >= spawnIntervalMs) {
    const occupied = new Set(moles.map((m) => m.holeIndex));
    const freeHoles = Array.from({ length: HOLE_COUNT }, (_, i) => i).filter((h) => !occupied.has(h));
    if (freeHoles.length > 0) {
      const holeIndex = freeHoles[Math.floor(rng() * freeHoles.length)];
      moles = [...moles, { holeIndex, expiresAtMs: elapsedMs + moleUpMs }];
      lastSpawnMs = elapsedMs;
    }
  }

  return {
    moles,
    score: state.score,
    misses,
    status: misses >= MAX_MISSES ? "over" : "playing",
    elapsedMs,
    lastSpawnMs,
  };
}

export function whackHole(state: WhackAMoleState, holeIndex: number): WhackAMoleState {
  if (state.status === "over") return state;
  const hit = state.moles.some((m) => m.holeIndex === holeIndex);
  if (!hit) return state;
  return { ...state, moles: state.moles.filter((m) => m.holeIndex !== holeIndex), score: state.score + 1 };
}
