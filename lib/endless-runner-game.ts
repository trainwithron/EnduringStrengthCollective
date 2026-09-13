// Endless runner, one of the rest-timer mini-game library (Phase 4,
// custom_shape_theming_idea.md). Simplified to a genuinely one-input
// game (jump only, no duck) to match the library's "one input" shape —
// a real, deliberate simplification of a classic endless-runner, not an
// oversight. Same pure-reducer convention as lib/snake-game.ts.

export interface RunnerObstacle {
  x: number;
  passed: boolean;
}

export interface RunnerGameState {
  playerY: number; // 0 = ground; negative = airborne (jumping)
  velocityY: number;
  obstacles: RunnerObstacle[];
  score: number;
  status: "playing" | "over";
}

export const BOARD_WIDTH = 300;
export const GROUND_Y = 0;
export const PLAYER_X = 50;
export const PLAYER_WIDTH = 20;
export const OBSTACLE_WIDTH = 16;
// How high (in the same logical units as playerY) a jump must clear an
// obstacle by — a jump that hasn't reached this height yet still
// collides with an obstacle at that x position.
export const JUMP_CLEARANCE = 22;
const GRAVITY = 1.1;
const JUMP_VELOCITY = -15;

export function createRunnerGame(): RunnerGameState {
  return {
    playerY: GROUND_Y,
    velocityY: 0,
    obstacles: [{ x: BOARD_WIDTH + 60, passed: false }],
    score: 0,
    status: "playing",
  };
}

// `scrollSpeed` and `obstacleGap` are driven by the caller's own
// difficulty multiplier — a faster scroll and a tighter gap between
// obstacles, closer to the end of the rest window, is what ramps the
// challenge as the window closes.
export function stepRunnerGame(
  state: RunnerGameState,
  jumpPressed: boolean,
  scrollSpeed: number,
  obstacleGap: number
): RunnerGameState {
  if (state.status === "over") return state;

  const isGrounded = state.playerY >= GROUND_Y;
  let velocityY = isGrounded && jumpPressed ? JUMP_VELOCITY : state.velocityY + GRAVITY;
  let playerY = state.playerY + velocityY;
  if (playerY >= GROUND_Y) {
    playerY = GROUND_Y;
    velocityY = 0;
  }

  let obstacles = state.obstacles.map((o) => ({ ...o, x: o.x - scrollSpeed }));
  let score = state.score;

  for (const o of obstacles) {
    if (!o.passed && o.x + OBSTACLE_WIDTH < PLAYER_X) {
      o.passed = true;
      score += 1;
    }
    const withinX = PLAYER_X + PLAYER_WIDTH > o.x && PLAYER_X < o.x + OBSTACLE_WIDTH;
    if (withinX && playerY > -JUMP_CLEARANCE) {
      return { ...state, playerY, velocityY, obstacles, score, status: "over" };
    }
  }

  obstacles = obstacles.filter((o) => o.x > -OBSTACLE_WIDTH);
  const lastX = obstacles.length > 0 ? obstacles[obstacles.length - 1].x : 0;
  if (BOARD_WIDTH - lastX >= obstacleGap) {
    obstacles = [...obstacles, { x: lastX + obstacleGap, passed: false }];
  }

  return { playerY, velocityY, obstacles, score, status: "playing" };
}
