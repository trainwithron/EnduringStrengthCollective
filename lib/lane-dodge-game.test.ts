import { describe, expect, it } from "vitest";
import {
  createLaneDodgeGame,
  stepLaneDodgeGame,
  LANE_COUNT,
  PLAYER_Y,
  BOARD_HEIGHT,
  type LaneDodgeState,
} from "./lane-dodge-game";

const fixedRng = () => 0; // always lane 0

describe("createLaneDodgeGame", () => {
  it("starts the player in the middle lane with one obstacle above the board", () => {
    const state = createLaneDodgeGame(fixedRng);
    expect(state.playerLane).toBe(Math.floor(LANE_COUNT / 2));
    expect(state.obstacles.length).toBe(1);
    expect(state.status).toBe("playing");
  });
});

describe("stepLaneDodgeGame", () => {
  it("moves the player one lane left or right per request", () => {
    const state = createLaneDodgeGame(fixedRng);
    const moved = stepLaneDodgeGame(state, 1, 5, 300, fixedRng);
    expect(moved.playerLane).toBe(state.playerLane + 1);
  });

  it("clamps lane movement at the board edges", () => {
    let state = createLaneDodgeGame(fixedRng);
    for (let i = 0; i < LANE_COUNT + 3; i++) {
      state = stepLaneDodgeGame(state, 1, 5, 300, fixedRng);
    }
    expect(state.playerLane).toBe(LANE_COUNT - 1);
  });

  it("colliding with an obstacle in the player's own lane ends the game", () => {
    const state: LaneDodgeState = {
      playerLane: 0,
      obstacles: [{ lane: 0, y: PLAYER_Y - 1, passed: false }],
      score: 0,
      status: "playing",
    };
    const next = stepLaneDodgeGame(state, null, 5, 300, fixedRng);
    expect(next.status).toBe("over");
  });

  it("an obstacle in a different lane does not end the game", () => {
    const state: LaneDodgeState = {
      playerLane: 0,
      obstacles: [{ lane: 1, y: PLAYER_Y - 1, passed: false }],
      score: 0,
      status: "playing",
    };
    const next = stepLaneDodgeGame(state, null, 5, 300, fixedRng);
    expect(next.status).toBe("playing");
  });

  it("scores a point once an obstacle passes the player's row", () => {
    const state: LaneDodgeState = {
      playerLane: 1,
      obstacles: [{ lane: 0, y: PLAYER_Y + 30, passed: false }],
      score: 0,
      status: "playing",
    };
    const next = stepLaneDodgeGame(state, null, 0, 300, fixedRng);
    expect(next.score).toBe(1);
  });

  it("removes obstacles once they scroll past the bottom of the board", () => {
    const state: LaneDodgeState = {
      playerLane: 1,
      obstacles: [{ lane: 0, y: BOARD_HEIGHT + 100, passed: true }],
      score: 0,
      status: "playing",
    };
    const next = stepLaneDodgeGame(state, null, 5, 100000, fixedRng);
    expect(next.obstacles.length).toBe(0);
  });

  it("a game already over never advances further", () => {
    const over: LaneDodgeState = { playerLane: 0, obstacles: [], score: 2, status: "over" };
    expect(stepLaneDodgeGame(over, 1, 5, 300, fixedRng)).toEqual(over);
  });
});
