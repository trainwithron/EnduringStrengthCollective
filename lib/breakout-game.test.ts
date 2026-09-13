import { describe, expect, it } from "vitest";
import {
  createBreakoutGame,
  stepBreakoutGame,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  PADDLE_Y,
  BALL_RADIUS,
  BRICK_TOP,
  BRICK_WIDTH,
  BRICK_HEIGHT,
  type BreakoutState,
} from "./breakout-game";

describe("createBreakoutGame", () => {
  it("starts with a full brick wall, centered paddle, ball above the paddle", () => {
    const state = createBreakoutGame();
    expect(state.bricks.every((b) => b.alive)).toBe(true);
    expect(state.paddleX).toBe(BOARD_WIDTH / 2);
    expect(state.status).toBe("playing");
  });
});

describe("stepBreakoutGame", () => {
  it("bounces off the left wall", () => {
    const state: BreakoutState = {
      ...createBreakoutGame(),
      ballX: BALL_RADIUS + 1,
      ballY: 200,
      ballVX: -3,
      ballVY: 1,
    };
    const next = stepBreakoutGame(state, BOARD_WIDTH / 2, 1);
    expect(next.ballVX).toBeGreaterThan(0);
  });

  it("bounces off the right wall", () => {
    const state: BreakoutState = {
      ...createBreakoutGame(),
      ballX: BOARD_WIDTH - BALL_RADIUS - 1,
      ballY: 200,
      ballVX: 3,
      ballVY: 1,
    };
    const next = stepBreakoutGame(state, BOARD_WIDTH / 2, 1);
    expect(next.ballVX).toBeLessThan(0);
  });

  it("bounces off the top wall", () => {
    const state: BreakoutState = {
      ...createBreakoutGame(),
      ballX: 150,
      ballY: BALL_RADIUS + 1,
      ballVX: 0,
      ballVY: -3,
    };
    const next = stepBreakoutGame(state, BOARD_WIDTH / 2, 1);
    expect(next.ballVY).toBeGreaterThan(0);
  });

  it("bounces off the paddle when the ball is descending into it", () => {
    const state: BreakoutState = {
      ...createBreakoutGame(),
      ballX: BOARD_WIDTH / 2,
      ballY: PADDLE_Y - 1,
      ballVX: 0,
      ballVY: 3,
    };
    const next = stepBreakoutGame(state, BOARD_WIDTH / 2, 1);
    expect(next.ballVY).toBeLessThan(0);
    expect(next.status).toBe("playing");
  });

  it("ends the game once the ball falls past the paddle", () => {
    const state: BreakoutState = {
      ...createBreakoutGame(),
      ballX: 150,
      ballY: BOARD_HEIGHT + 5, // already well past the paddle's y-band
      ballVX: 0,
      ballVY: 10,
    };
    const next = stepBreakoutGame(state, 0, 1);
    expect(next.status).toBe("over");
  });

  it("breaks a brick on contact and scores a point", () => {
    const brickX = BRICK_WIDTH * 2 + BRICK_WIDTH / 2;
    const brickY = BRICK_TOP + BRICK_HEIGHT / 2;
    const state: BreakoutState = {
      ...createBreakoutGame(),
      ballX: brickX,
      ballY: brickY + 1,
      ballVX: 0,
      ballVY: -1,
    };
    const next = stepBreakoutGame(state, BOARD_WIDTH / 2, 1);
    expect(next.score).toBe(1);
    const hitBrick = next.bricks.find((b) => b.col === 2 && b.row === 0);
    expect(hitBrick?.alive).toBe(false);
  });

  it("regenerates the wall once every brick is cleared, rather than ending the round", () => {
    const clearedBricks = createBreakoutGame().bricks.map((b) => ({ ...b, alive: false }));
    const state: BreakoutState = {
      ...createBreakoutGame(),
      bricks: clearedBricks,
      ballX: 150,
      ballY: 200,
      ballVX: 0,
      ballVY: 1,
    };
    const next = stepBreakoutGame(state, BOARD_WIDTH / 2, 1);
    expect(next.status).toBe("playing");
    expect(next.bricks.some((b) => b.alive)).toBe(true);
  });

  it("clamps the paddle within the board", () => {
    const state = createBreakoutGame();
    const next = stepBreakoutGame(state, -1000, 1);
    expect(next.paddleX).toBeGreaterThanOrEqual(0);
    expect(next.paddleX).toBeLessThanOrEqual(BOARD_WIDTH);
  });

  it("speedMultiplier scales how far the ball travels in one tick", () => {
    const slow = stepBreakoutGame(createBreakoutGame(), BOARD_WIDTH / 2, 1);
    const fast = stepBreakoutGame(createBreakoutGame(), BOARD_WIDTH / 2, 3);
    const slowDelta = Math.abs(slow.ballY - createBreakoutGame().ballY);
    const fastDelta = Math.abs(fast.ballY - createBreakoutGame().ballY);
    expect(fastDelta).toBeGreaterThan(slowDelta);
  });

  it("a game already over never advances further", () => {
    const over: BreakoutState = { ...createBreakoutGame(), status: "over" };
    expect(stepBreakoutGame(over, 10, 2)).toEqual(over);
  });
});
