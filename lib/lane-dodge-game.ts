// Lane-dodge, one of the rest-timer mini-game library (Phase 4,
// custom_shape_theming_idea.md) — obstacles fall down fixed lanes,
// swipe/tap left-right to switch lanes and avoid them. Same pure-reducer
// convention as lib/snake-game.ts.

export interface LaneObstacle {
  lane: number;
  y: number;
  passed: boolean;
}

export interface LaneDodgeState {
  playerLane: number;
  obstacles: LaneObstacle[];
  score: number;
  status: "playing" | "over";
}

export const LANE_COUNT = 3;
export const BOARD_HEIGHT = 400;
export const PLAYER_Y = 360;
export const OBSTACLE_HEIGHT = 24;
export const PLAYER_HEIGHT = 24;

export function createLaneDodgeGame(rng: () => number = Math.random): LaneDodgeState {
  return {
    playerLane: Math.floor(LANE_COUNT / 2),
    obstacles: [{ lane: Math.floor(rng() * LANE_COUNT), y: -OBSTACLE_HEIGHT, passed: false }],
    score: 0,
    status: "playing",
  };
}

// `laneChange` is -1/1/null (the athlete's latest swipe/tap, or none
// this tick). `scrollSpeed` and `spawnGapPx` are driven by the caller's
// own difficulty multiplier — a faster fall and tighter vertical gap
// between obstacles, closer to the end of the rest window, is what
// ramps the challenge as the window closes.
export function stepLaneDodgeGame(
  state: LaneDodgeState,
  laneChange: -1 | 1 | null,
  scrollSpeed: number,
  spawnGapPx: number,
  rng: () => number = Math.random
): LaneDodgeState {
  if (state.status === "over") return state;

  const playerLane = Math.min(LANE_COUNT - 1, Math.max(0, state.playerLane + (laneChange ?? 0)));

  let obstacles = state.obstacles.map((o) => ({ ...o, y: o.y + scrollSpeed }));
  let score = state.score;

  for (const o of obstacles) {
    const overlapsPlayerBand = o.y + OBSTACLE_HEIGHT > PLAYER_Y && o.y < PLAYER_Y + PLAYER_HEIGHT;
    if (overlapsPlayerBand && o.lane === playerLane) {
      return { ...state, playerLane, obstacles, score, status: "over" };
    }
    if (!o.passed && o.y > PLAYER_Y + PLAYER_HEIGHT) {
      o.passed = true;
      score += 1;
    }
  }

  obstacles = obstacles.filter((o) => o.y < BOARD_HEIGHT + OBSTACLE_HEIGHT);
  const lowestY = obstacles.length > 0 ? Math.max(...obstacles.map((o) => o.y)) : -Infinity;
  if (lowestY >= spawnGapPx - OBSTACLE_HEIGHT) {
    obstacles = [...obstacles, { lane: Math.floor(rng() * LANE_COUNT), y: -OBSTACLE_HEIGHT, passed: false }];
  }

  return { playerLane, obstacles, score, status: "playing" };
}
