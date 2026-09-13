// Brick-breaker / paddle-and-ball, one of the rest-timer mini-game
// library (Phase 4, custom_shape_theming_idea.md) — "ball speed
// increases the longer it survives" per the original spec, which maps
// directly onto the shared difficulty-ramp engine's speedMultiplier.
// Same pure-reducer convention as lib/snake-game.ts. When every brick
// is cleared, the wall simply regenerates (endless mode) rather than
// ending the round — the only real game-over condition is the ball
// falling past the paddle, consistent with survival being the thing
// that ramps toward a natural death here.

export interface Brick {
  col: number;
  row: number;
  alive: boolean;
}

export interface BreakoutState {
  paddleX: number; // center x
  ballX: number;
  ballY: number;
  ballVX: number;
  ballVY: number;
  bricks: Brick[];
  score: number;
  status: "playing" | "over";
}

export const BOARD_WIDTH = 300;
export const BOARD_HEIGHT = 400;
export const PADDLE_WIDTH = 60;
export const PADDLE_Y = 380;
export const PADDLE_HEIGHT = 8;
export const BALL_RADIUS = 6;
export const BRICK_ROWS = 4;
export const BRICK_COLS = 6;
export const BRICK_WIDTH = BOARD_WIDTH / BRICK_COLS;
export const BRICK_HEIGHT = 16;
export const BRICK_TOP = 30;
const BASE_BALL_SPEED = 3;

function freshBricks(): Brick[] {
  const bricks: Brick[] = [];
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      bricks.push({ col, row, alive: true });
    }
  }
  return bricks;
}

export function createBreakoutGame(): BreakoutState {
  return {
    paddleX: BOARD_WIDTH / 2,
    ballX: BOARD_WIDTH / 2,
    ballY: PADDLE_Y - BALL_RADIUS - 1,
    ballVX: BASE_BALL_SPEED * 0.6,
    ballVY: -BASE_BALL_SPEED,
    bricks: freshBricks(),
    score: 0,
    status: "playing",
  };
}

// `paddleX` is the athlete's live input (drag/touch position, already
// clamped by the caller to a sane range) each tick. `speedMultiplier`
// scales the ball's base velocity — driven by the caller's own
// difficulty ramp, so the ball genuinely moves faster as the rest
// window closes.
export function stepBreakoutGame(state: BreakoutState, paddleX: number, speedMultiplier: number): BreakoutState {
  if (state.status === "over") return state;

  const paddleXClamped = Math.min(BOARD_WIDTH - PADDLE_WIDTH / 2, Math.max(PADDLE_WIDTH / 2, paddleX));

  let ballX = state.ballX + state.ballVX * speedMultiplier;
  let ballY = state.ballY + state.ballVY * speedMultiplier;
  let ballVX = state.ballVX;
  let ballVY = state.ballVY;

  if (ballX - BALL_RADIUS < 0) {
    ballX = BALL_RADIUS;
    ballVX = Math.abs(ballVX);
  } else if (ballX + BALL_RADIUS > BOARD_WIDTH) {
    ballX = BOARD_WIDTH - BALL_RADIUS;
    ballVX = -Math.abs(ballVX);
  }
  if (ballY - BALL_RADIUS < 0) {
    ballY = BALL_RADIUS;
    ballVY = Math.abs(ballVY);
  }

  // Paddle bounce — only when descending and within the paddle's x-range
  // at the paddle's y-band. Hit position offsets the outgoing angle so
  // the paddle is a real steering input, not just a wall.
  const withinPaddleX = ballX > paddleXClamped - PADDLE_WIDTH / 2 && ballX < paddleXClamped + PADDLE_WIDTH / 2;
  const atPaddleY = ballY + BALL_RADIUS >= PADDLE_Y && ballY + BALL_RADIUS <= PADDLE_Y + PADDLE_HEIGHT + 4;
  if (ballVY > 0 && withinPaddleX && atPaddleY) {
    const hitOffset = (ballX - paddleXClamped) / (PADDLE_WIDTH / 2); // -1..1
    ballVY = -Math.abs(ballVY);
    ballVX = BASE_BALL_SPEED * hitOffset;
  }

  // Ball fell past the paddle entirely -- the round's only real
  // game-over condition.
  if (ballY - BALL_RADIUS > BOARD_HEIGHT) {
    return { ...state, paddleX: paddleXClamped, ballX, ballY, ballVX, ballVY, status: "over" };
  }

  let bricks = state.bricks;
  let score = state.score;
  for (let i = 0; i < bricks.length; i++) {
    const b = bricks[i];
    if (!b.alive) continue;
    const bx = b.col * BRICK_WIDTH;
    const by = BRICK_TOP + b.row * BRICK_HEIGHT;
    const withinX = ballX + BALL_RADIUS > bx && ballX - BALL_RADIUS < bx + BRICK_WIDTH;
    const withinY = ballY + BALL_RADIUS > by && ballY - BALL_RADIUS < by + BRICK_HEIGHT;
    if (withinX && withinY) {
      bricks = bricks.map((br, idx) => (idx === i ? { ...br, alive: false } : br));
      score += 1;
      ballVY = -ballVY;
      break; // one brick per tick is plenty for this simple a physics model
    }
  }

  // Endless mode — a fully-cleared wall regenerates rather than ending
  // the round; survival (not clearing bricks) is what ramps here.
  if (bricks.every((b) => !b.alive)) {
    bricks = freshBricks();
  }

  return { paddleX: paddleXClamped, ballX, ballY, ballVX, ballVY, bricks, score, status: "playing" };
}
