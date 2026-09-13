import { describe, expect, it } from "vitest";
import {
  createFlappyGame,
  stepFlappyGame,
  BOARD_HEIGHT,
  BIRD_X,
  PIPE_WIDTH,
  type FlappyGameState,
} from "./flappy-game";

const centerRng = () => 0.5; // deterministic gap centered at BOARD_HEIGHT / 2

describe("createFlappyGame", () => {
  it("starts the bird at mid-height, not moving, with one pipe ahead", () => {
    const state = createFlappyGame(centerRng);
    expect(state.birdY).toBe(BOARD_HEIGHT / 2);
    expect(state.velocityY).toBe(0);
    expect(state.status).toBe("playing");
    expect(state.pipes.length).toBe(1);
  });
});

describe("stepFlappyGame", () => {
  it("flapping applies an upward velocity", () => {
    const state = createFlappyGame(centerRng);
    const flapped = stepFlappyGame(state, true, 2, 120, centerRng);
    expect(flapped.velocityY).toBeLessThan(0);
    expect(flapped.birdY).toBeLessThan(state.birdY);
  });

  it("gravity pulls the bird down when not flapping", () => {
    const state = createFlappyGame(centerRng);
    const fallen = stepFlappyGame(state, false, 2, 120, centerRng);
    expect(fallen.velocityY).toBeGreaterThan(0);
    expect(fallen.birdY).toBeGreaterThan(state.birdY);
  });

  it("ends the game when the bird falls below the board", () => {
    let state: FlappyGameState = createFlappyGame(centerRng);
    for (let i = 0; i < 100 && state.status === "playing"; i++) {
      state = stepFlappyGame(state, false, 2, 120, centerRng);
    }
    expect(state.status).toBe("over");
  });

  it("passing safely through a centered gap does not end the game", () => {
    // Pipe starts well ahead of the bird; step until it reaches the
    // bird's x position while the bird stays near the (centered) gap.
    let state: FlappyGameState = createFlappyGame(centerRng);
    const scrollSpeed = 4;
    for (let i = 0; i < 30; i++) {
      const nearestPipeX = Math.min(...state.pipes.map((p) => p.x));
      // Small taps to hover the bird near board center, matching the
      // pipe's centered gap.
      const flap = state.birdY > BOARD_HEIGHT / 2;
      state = stepFlappyGame(state, flap, scrollSpeed, 150, centerRng);
      if (state.status === "over") break;
      if (nearestPipeX < BIRD_X - PIPE_WIDTH) break; // already passed
    }
    expect(state.status).toBe("playing");
  });

  it("colliding with a pipe (bird far from the gap) ends the game", () => {
    // Force the bird to the very top (far from a centered gap) right as
    // a close pipe reaches it.
    let state: FlappyGameState = {
      birdY: 10,
      velocityY: 0,
      pipes: [{ x: BIRD_X, gapCenter: BOARD_HEIGHT / 2, passed: false }],
      score: 0,
      status: "playing",
    };
    state = stepFlappyGame(state, false, 0, 40, centerRng);
    expect(state.status).toBe("over");
  });

  it("scrolls pipes left by scrollSpeed each tick", () => {
    const state = createFlappyGame(centerRng);
    const startX = state.pipes[0].x;
    const next = stepFlappyGame(state, false, 5, 120, centerRng);
    expect(next.pipes[0].x).toBe(startX - 5);
  });

  it("increments score once a pipe is fully passed", () => {
    // Right edge (x + PIPE_WIDTH) must clear BIRD_X - BIRD_RADIUS (50).
    const state: FlappyGameState = {
      birdY: BOARD_HEIGHT / 2,
      velocityY: 0,
      pipes: [{ x: 10, gapCenter: BOARD_HEIGHT / 2, passed: false }],
      score: 0,
      status: "playing",
    };
    const next = stepFlappyGame(state, false, 0, 200, centerRng);
    expect(next.score).toBe(1);
  });

  it("spawns a new pipe once there is enough spacing ahead of the last one", () => {
    const state: FlappyGameState = {
      birdY: BOARD_HEIGHT / 2,
      velocityY: 0,
      pipes: [{ x: 10, gapCenter: BOARD_HEIGHT / 2, passed: true }],
      score: 0,
      status: "playing",
    };
    const next = stepFlappyGame(state, false, 0, 200, centerRng);
    expect(next.pipes.length).toBe(2);
    expect(next.pipes[1].x).toBeGreaterThan(next.pipes[0].x);
  });

  it("a game already over never advances further", () => {
    const over: FlappyGameState = {
      birdY: 5,
      velocityY: 3,
      pipes: [],
      score: 7,
      status: "over",
    };
    expect(stepFlappyGame(over, true, 5, 120, centerRng)).toEqual(over);
  });
});
