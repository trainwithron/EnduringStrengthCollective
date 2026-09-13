// Flappy-style tap-to-fly, one of the rest-timer mini-game library
// (Phase 4, custom_shape_theming_idea.md). Same pure-reducer convention
// as lib/snake-game.ts — a step function advances exactly one tick, the
// renderer just draws whatever state comes back. Logical coordinate
// space (300x400), scaled by the renderer, not tied to a pixel canvas.

export interface FlappyPipe {
  x: number; // leading edge
  gapCenter: number;
  passed: boolean;
}

export interface FlappyGameState {
  birdY: number;
  velocityY: number;
  pipes: FlappyPipe[];
  score: number;
  status: "playing" | "over";
}

export const BOARD_WIDTH = 300;
export const BOARD_HEIGHT = 400;
export const BIRD_X = 60;
export const BIRD_RADIUS = 10;
export const PIPE_WIDTH = 30;
const GRAVITY = 0.5;
const FLAP_VELOCITY = -7;
const PIPE_SPACING = 160;
const PIPE_MARGIN = 50;

function makePipe(x: number, rng: () => number): FlappyPipe {
  return { x, gapCenter: PIPE_MARGIN + rng() * (BOARD_HEIGHT - PIPE_MARGIN * 2), passed: false };
}

export function createFlappyGame(rng: () => number = Math.random): FlappyGameState {
  return {
    birdY: BOARD_HEIGHT / 2,
    velocityY: 0,
    pipes: [makePipe(BOARD_WIDTH + 80, rng)],
    score: 0,
    status: "playing",
  };
}

// `scrollSpeed` and `gapHeight` are driven by the caller's own
// difficulty multiplier (lib/rest-timer-difficulty.ts) — a faster
// scroll and a narrower gap, closer to the end of the rest window, is
// what makes the game harder as the window closes.
export function stepFlappyGame(
  state: FlappyGameState,
  flapped: boolean,
  scrollSpeed: number,
  gapHeight: number,
  rng: () => number = Math.random
): FlappyGameState {
  if (state.status === "over") return state;

  const velocityY = flapped ? FLAP_VELOCITY : state.velocityY + GRAVITY;
  const birdY = state.birdY + velocityY;

  if (birdY - BIRD_RADIUS < 0 || birdY + BIRD_RADIUS > BOARD_HEIGHT) {
    return { ...state, birdY, velocityY, status: "over" };
  }

  let pipes = state.pipes.map((p) => ({ ...p, x: p.x - scrollSpeed }));
  let score = state.score;

  for (const pipe of pipes) {
    if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X - BIRD_RADIUS) {
      pipe.passed = true;
      score += 1;
    }
    const withinX = BIRD_X + BIRD_RADIUS > pipe.x && BIRD_X - BIRD_RADIUS < pipe.x + PIPE_WIDTH;
    if (withinX) {
      const gapTop = pipe.gapCenter - gapHeight / 2;
      const gapBottom = pipe.gapCenter + gapHeight / 2;
      if (birdY - BIRD_RADIUS < gapTop || birdY + BIRD_RADIUS > gapBottom) {
        return { ...state, birdY, velocityY, pipes, score, status: "over" };
      }
    }
  }

  pipes = pipes.filter((p) => p.x > -PIPE_WIDTH);
  const lastX = pipes.length > 0 ? pipes[pipes.length - 1].x : 0;
  if (BOARD_WIDTH - lastX >= PIPE_SPACING) {
    pipes = [...pipes, makePipe(lastX + PIPE_SPACING, rng)];
  }

  return { birdY, velocityY, pipes, score, status: "playing" };
}
