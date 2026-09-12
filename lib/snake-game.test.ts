import { describe, it, expect } from "vitest";
import { createSnakeGame, stepSnakeGame, isOppositeDirection } from "./snake-game";

// Deterministic "random" for reproducible food placement in tests.
function seededRng(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

describe("isOppositeDirection", () => {
  it("recognizes true opposites", () => {
    expect(isOppositeDirection("up", "down")).toBe(true);
    expect(isOppositeDirection("left", "right")).toBe(true);
  });

  it("does not flag perpendicular or identical directions", () => {
    expect(isOppositeDirection("up", "left")).toBe(false);
    expect(isOppositeDirection("up", "up")).toBe(false);
  });
});

describe("createSnakeGame", () => {
  it("starts with a 3-segment snake, moving right, status playing, score 0", () => {
    const state = createSnakeGame(15, seededRng(1));
    expect(state.snake).toHaveLength(3);
    expect(state.direction).toBe("right");
    expect(state.status).toBe("playing");
    expect(state.score).toBe(0);
  });

  it("never places food on top of the snake", () => {
    const state = createSnakeGame(15, seededRng(1));
    const onSnake = state.snake.some((s) => s.x === state.food.x && s.y === state.food.y);
    expect(onSnake).toBe(false);
  });
});

describe("stepSnakeGame", () => {
  it("moves the snake one cell in its current direction", () => {
    const state = createSnakeGame(15, seededRng(1));
    const head = state.snake[0];
    const next = stepSnakeGame(state, null, seededRng(2));
    expect(next.snake[0]).toEqual({ x: head.x + 1, y: head.y });
    expect(next.snake).toHaveLength(3); // no growth without eating
  });

  it("ignores a direction change that would reverse straight into itself", () => {
    const state = createSnakeGame(15, seededRng(1)); // moving right
    const next = stepSnakeGame(state, "left", seededRng(2));
    // Still moved right (ignored the illegal reversal), not left.
    expect(next.direction).toBe("right");
  });

  it("accepts a legal turn", () => {
    const state = createSnakeGame(15, seededRng(1)); // moving right
    const next = stepSnakeGame(state, "up", seededRng(2));
    expect(next.direction).toBe("up");
    expect(next.snake[0].y).toBe(state.snake[0].y - 1);
  });

  it("ends the game on a wall collision", () => {
    let state = createSnakeGame(5, seededRng(1));
    // Drive it off the right edge.
    for (let i = 0; i < 10 && state.status === "playing"; i++) {
      state = stepSnakeGame(state, "right", seededRng(2));
    }
    expect(state.status).toBe("over");
  });

  it("ends the game on self-collision", () => {
    // A hexagon-shaped body: head at (2,2) moving left, with (2,1) — a
    // MIDDLE body segment, not the tail — directly above the head. The
    // tail vacates safely on any ordinary move; turning "up" here drives
    // the head straight into that middle segment instead.
    const state = {
      snake: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
      ],
      direction: "left" as const,
      food: { x: 10, y: 10 },
      gridSize: 15,
      status: "playing" as const,
      score: 0,
    };
    const next = stepSnakeGame(state, "up", seededRng(1));
    expect(next.status).toBe("over");
  });

  it("grows and scores when eating food, and relocates the food", () => {
    let state = createSnakeGame(15, seededRng(1));
    // Force food directly in front of the head.
    const head = state.snake[0];
    state = { ...state, food: { x: head.x + 1, y: head.y } };
    const next = stepSnakeGame(state, null, seededRng(2));
    expect(next.score).toBe(1);
    expect(next.snake).toHaveLength(4); // grew by one
    expect(next.food).not.toEqual({ x: head.x + 1, y: head.y }); // relocated
  });

  it("does nothing once the game is already over", () => {
    const overState = { ...createSnakeGame(15, seededRng(1)), status: "over" as const };
    const next = stepSnakeGame(overState, "up", seededRng(2));
    expect(next).toEqual(overState);
  });
});
