// Phase 4 of the gamified-logging thread (custom_shape_theming_idea.md)
// — a rest-timer mini-game. Rescoped by Ron directly from tower-defense
// to classic phone games (Snake/Pong): single-axis-ish input, minimal
// rules, no enemy AI/pathing/spawning logic, and — the real fit
// advantage over tower-defense — a round naturally ends whenever you
// lose, so it never fights the rest countdown's own hard cutoff.
//
// Pure, DOM-free game state — a reducer-style step function so the
// renderer (components/session/snake-mini-game.tsx) just draws whatever
// state comes back, and the whole thing is unit-testable without a
// canvas or a browser at all.

export type Direction = "up" | "down" | "left" | "right";

export interface Point {
  x: number;
  y: number;
}

export interface SnakeGameState {
  snake: Point[]; // head first
  direction: Direction;
  food: Point;
  gridSize: number;
  status: "playing" | "over";
  score: number;
}

const DELTAS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function isOppositeDirection(a: Direction, b: Direction): boolean {
  return DELTAS[a].x === -DELTAS[b].x && DELTAS[a].y === -DELTAS[b].y;
}

function placeFood(snake: Point[], gridSize: number, rng: () => number): Point {
  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  // A full board (snake fills every cell) has nowhere left for food —
  // returns off-grid, which stepSnakeGame's own bounds check means it
  // can never actually be "eaten," matching "you won, effectively" rather
  // than crashing.
  if (free.length === 0) return { x: -1, y: -1 };
  return free[Math.floor(rng() * free.length)];
}

export function createSnakeGame(gridSize = 15, rng: () => number = Math.random): SnakeGameState {
  const mid = Math.floor(gridSize / 2);
  const snake: Point[] = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  return {
    snake,
    direction: "right",
    food: placeFood(snake, gridSize, rng),
    gridSize,
    status: "playing",
    score: 0,
  };
}

// Advances exactly one tick. `nextDirection` is the athlete's latest
// input (or null if they haven't turned since the last tick) — ignored
// if it would reverse the snake directly into itself, the one real rule
// every classic Snake shares.
export function stepSnakeGame(
  state: SnakeGameState,
  nextDirection: Direction | null,
  rng: () => number = Math.random
): SnakeGameState {
  if (state.status === "over") return state;

  const direction =
    nextDirection && !isOppositeDirection(nextDirection, state.direction) ? nextDirection : state.direction;

  const head = state.snake[0];
  const delta = DELTAS[direction];
  const newHead: Point = { x: head.x + delta.x, y: head.y + delta.y };

  const outOfBounds =
    newHead.x < 0 || newHead.x >= state.gridSize || newHead.y < 0 || newHead.y >= state.gridSize;
  if (outOfBounds) {
    return { ...state, direction, status: "over" };
  }

  const ateFood = newHead.x === state.food.x && newHead.y === state.food.y;
  // The tail cell vacates this same tick unless the snake is growing —
  // moving into "where the tail was" is legal, moving into any other
  // body segment is not.
  const bodyToCheck = ateFood ? state.snake : state.snake.slice(0, -1);
  const collided = bodyToCheck.some((seg) => seg.x === newHead.x && seg.y === newHead.y);
  if (collided) {
    return { ...state, direction, status: "over" };
  }

  const newSnake = [newHead, ...state.snake];
  if (!ateFood) newSnake.pop();

  return {
    ...state,
    snake: newSnake,
    direction,
    score: ateFood ? state.score + 1 : state.score,
    food: ateFood ? placeFood(newSnake, state.gridSize, rng) : state.food,
  };
}
