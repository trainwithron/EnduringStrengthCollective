import { describe, expect, it } from "vitest";
import {
  createRunnerGame,
  stepRunnerGame,
  GROUND_Y,
  PLAYER_X,
  type RunnerGameState,
} from "./endless-runner-game";

describe("createRunnerGame", () => {
  it("starts grounded, not moving, with one obstacle ahead", () => {
    const state = createRunnerGame();
    expect(state.playerY).toBe(GROUND_Y);
    expect(state.velocityY).toBe(0);
    expect(state.status).toBe("playing");
    expect(state.obstacles.length).toBe(1);
  });
});

describe("stepRunnerGame", () => {
  it("jumping from the ground applies upward velocity", () => {
    const state = createRunnerGame();
    const jumped = stepRunnerGame(state, true, 3, 140);
    expect(jumped.velocityY).toBeLessThan(0);
    expect(jumped.playerY).toBeLessThan(0);
  });

  it("cannot jump again while already airborne", () => {
    let state = stepRunnerGame(createRunnerGame(), true, 3, 140);
    const midAirVelocity = state.velocityY;
    state = stepRunnerGame(state, true, 3, 140);
    // Gravity accumulates rather than re-triggering a fresh jump impulse.
    expect(state.velocityY).toBeGreaterThan(midAirVelocity);
  });

  it("gravity brings the player back to the ground eventually", () => {
    let state: RunnerGameState = stepRunnerGame(createRunnerGame(), true, 0, 1000);
    for (let i = 0; i < 50 && state.playerY < GROUND_Y; i++) {
      state = stepRunnerGame(state, false, 0, 1000);
    }
    expect(state.playerY).toBe(GROUND_Y);
    expect(state.velocityY).toBe(0);
  });

  it("colliding with a ground obstacle while not jumped high enough ends the game", () => {
    const state: RunnerGameState = {
      playerY: GROUND_Y,
      velocityY: 0,
      obstacles: [{ x: PLAYER_X, passed: false }],
      score: 0,
      status: "playing",
    };
    const next = stepRunnerGame(state, false, 0, 140);
    expect(next.status).toBe("over");
  });

  it("clearing an obstacle with a high enough jump does not end the game", () => {
    const state: RunnerGameState = {
      playerY: -30, // well above JUMP_CLEARANCE
      velocityY: -2,
      obstacles: [{ x: PLAYER_X, passed: false }],
      score: 0,
      status: "playing",
    };
    const next = stepRunnerGame(state, false, 0, 140);
    expect(next.status).toBe("playing");
  });

  it("increments score once an obstacle is fully passed", () => {
    const state: RunnerGameState = {
      playerY: GROUND_Y,
      velocityY: 0,
      obstacles: [{ x: 10, passed: false }],
      score: 0,
      status: "playing",
    };
    const next = stepRunnerGame(state, false, 0, 140);
    expect(next.score).toBe(1);
  });

  it("spawns a new obstacle once there is enough gap ahead of the last one", () => {
    const state: RunnerGameState = {
      playerY: GROUND_Y,
      velocityY: 0,
      obstacles: [{ x: 10, passed: true }],
      score: 0,
      status: "playing",
    };
    const next = stepRunnerGame(state, false, 0, 140);
    expect(next.obstacles.length).toBe(2);
    expect(next.obstacles[1].x).toBeGreaterThan(next.obstacles[0].x);
  });

  it("a game already over never advances further", () => {
    const over: RunnerGameState = { playerY: 0, velocityY: 0, obstacles: [], score: 4, status: "over" };
    expect(stepRunnerGame(over, true, 3, 140)).toEqual(over);
  });

  it("scrolls obstacles left by scrollSpeed each tick", () => {
    const state = createRunnerGame();
    const startX = state.obstacles[0].x;
    const next = stepRunnerGame(state, false, 5, 140);
    expect(next.obstacles[0].x).toBe(startX - 5);
  });
});
