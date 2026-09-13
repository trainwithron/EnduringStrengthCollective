import { describe, expect, it } from "vitest";
import {
  createWhackAMoleGame,
  stepWhackAMoleTick,
  whackHole,
  MAX_MISSES,
  HOLE_COUNT,
  type WhackAMoleState,
} from "./whack-a-mole-game";

const fixedRng = () => 0; // always picks the first free hole, deterministic

describe("createWhackAMoleGame", () => {
  it("starts with no moles, no score, no misses", () => {
    const state = createWhackAMoleGame();
    expect(state.moles).toEqual([]);
    expect(state.score).toBe(0);
    expect(state.misses).toBe(0);
    expect(state.status).toBe("playing");
  });
});

describe("stepWhackAMoleTick", () => {
  it("spawns a mole once the spawn interval has elapsed", () => {
    const state = createWhackAMoleGame();
    const next = stepWhackAMoleTick(state, 1000, 1000, 1500, fixedRng);
    expect(next.moles.length).toBe(1);
    expect(next.moles[0].holeIndex).toBe(0);
  });

  it("does not spawn a second mole before the interval has elapsed since the first", () => {
    // The very first tick always spawns immediately (nothing has spawned
    // yet, so there's no "interval since last spawn" to wait out) --
    // the interval only gates the gap BETWEEN spawns.
    let state = stepWhackAMoleTick(createWhackAMoleGame(), 0, 1000, 1500, fixedRng);
    expect(state.moles.length).toBe(1);
    state = stepWhackAMoleTick(state, 500, 1000, 1500, fixedRng);
    expect(state.moles.length).toBe(1);
  });

  it("counts an expired, unhit mole as a miss", () => {
    let state = stepWhackAMoleTick(createWhackAMoleGame(), 0, 0, 500, fixedRng);
    expect(state.moles.length).toBe(1);
    state = stepWhackAMoleTick(state, 600, 100000, 500, fixedRng);
    expect(state.misses).toBe(1);
    expect(state.moles.length).toBe(0);
  });

  it("ends the game once misses reach the max", () => {
    let state: WhackAMoleState = createWhackAMoleGame();
    for (let i = 0; i < MAX_MISSES; i++) {
      state = stepWhackAMoleTick(state, 0, 0, 100, fixedRng); // spawn
      state = stepWhackAMoleTick(state, 200, 100000, 100, fixedRng); // expire -> miss
    }
    expect(state.misses).toBe(MAX_MISSES);
    expect(state.status).toBe("over");
  });

  it("never spawns two moles in the same hole at once", () => {
    let state = createWhackAMoleGame();
    // Spawn one mole in hole 0 (fixedRng picks the first free hole).
    state = stepWhackAMoleTick(state, 0, 0, 5000, fixedRng);
    expect(state.moles.map((m) => m.holeIndex)).toEqual([0]);
    // Force another spawn immediately -- must land in a DIFFERENT hole
    // since hole 0 is occupied, even though rng always returns 0 (picks
    // the first free hole, and hole 0 is no longer free).
    state = stepWhackAMoleTick(state, 0, 0, 5000, fixedRng);
    const holes = state.moles.map((m) => m.holeIndex);
    expect(new Set(holes).size).toBe(holes.length);
  });

  it("a game already over never advances further", () => {
    const over: WhackAMoleState = {
      moles: [],
      score: 3,
      misses: MAX_MISSES,
      status: "over",
      elapsedMs: 1000,
      lastSpawnMs: 900,
    };
    expect(stepWhackAMoleTick(over, 500, 100, 500, fixedRng)).toEqual(over);
  });
});

describe("whackHole", () => {
  it("scores a point and removes the mole when hit while up", () => {
    let state = stepWhackAMoleTick(createWhackAMoleGame(), 0, 0, 1000, fixedRng);
    const holeIndex = state.moles[0].holeIndex;
    state = whackHole(state, holeIndex);
    expect(state.score).toBe(1);
    expect(state.moles.length).toBe(0);
  });

  it("tapping an empty hole does nothing", () => {
    const state = createWhackAMoleGame();
    const next = whackHole(state, 4);
    expect(next).toEqual(state);
  });

  it("respects the real hole count when spawning", () => {
    let state = createWhackAMoleGame();
    // Fill every hole one at a time using a round-robin rng.
    let i = 0;
    const roundRobinRng = () => {
      const v = i / HOLE_COUNT;
      i++;
      return v;
    };
    for (let n = 0; n < HOLE_COUNT; n++) {
      state = stepWhackAMoleTick(state, 0, 0, 100000, roundRobinRng);
    }
    expect(state.moles.length).toBe(HOLE_COUNT);
    // One more spawn attempt with every hole full should not add a 10th.
    state = stepWhackAMoleTick(state, 0, 0, 100000, roundRobinRng);
    expect(state.moles.length).toBe(HOLE_COUNT);
  });
});
