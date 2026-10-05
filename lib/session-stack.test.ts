import { describe, it, expect } from "vitest";
import { buildSessionStack, compareProgramOrder, programHeading, type ProgramToday } from "./session-stack";

function prog(over: Partial<ProgramToday>): ProgramToday {
  return {
    programId: "p",
    name: "Program",
    label: null,
    sortOrder: null,
    createdAt: "2026-09-01T00:00:00Z",
    kind: "ready",
    workoutId: "w",
    title: "Day 1",
    unlocksOn: null,
    ...over,
  };
}

describe("buildSessionStack", () => {
  it("shows a card for each program with something ready, main first by age", () => {
    const { cards } = buildSessionStack([
      prog({ programId: "mob", name: "Mobility", createdAt: "2026-09-10T00:00:00Z", workoutId: "w2", title: "Hips" }),
      prog({ programId: "main", name: "Main", createdAt: "2026-09-01T00:00:00Z", workoutId: "w1", title: "Squat day" }),
    ]);
    expect(cards.map((c) => c.programId)).toEqual(["main", "mob"]);
  });

  it("the coach's sort order beats age", () => {
    const { cards } = buildSessionStack([
      prog({ programId: "main", sortOrder: 2, workoutId: "w1" }),
      prog({ programId: "warm", sortOrder: 1, createdAt: "2026-09-20T00:00:00Z", workoutId: "w2" }),
    ]);
    expect(cards.map((c) => c.programId)).toEqual(["warm", "main"]);
  });

  it("numbered programs come before unnumbered ones", () => {
    expect(compareProgramOrder({ sortOrder: 5, createdAt: "2026-10-01" }, { sortOrder: null, createdAt: "2026-01-01" })).toBeLessThan(0);
  });

  it("a program done today stays as a done card beside one still to do", () => {
    const { cards } = buildSessionStack([
      prog({ programId: "main", kind: "done_today", workoutId: "w1" }),
      prog({ programId: "mob", kind: "ready", workoutId: "w2" }),
    ]);
    expect(cards.map((c) => [c.programId, c.status])).toEqual([
      ["main", "done"],
      ["mob", "ready"],
    ]);
  });

  it("a mobility program shows on a day the main program is resting", () => {
    const { cards } = buildSessionStack([
      prog({ programId: "main", kind: "locked", unlocksOn: new Date("2026-10-08T00:00:00"), workoutId: "w1" }),
      prog({ programId: "mob", kind: "ready", workoutId: "w2" }),
    ]);
    expect(cards.map((c) => c.programId)).toEqual(["mob"]);
  });

  it("uses the label as the card heading, falling back to the program name", () => {
    expect(programHeading({ name: "Block 3", label: "Main" })).toBe("Main");
    expect(programHeading({ name: "Block 3", label: "  " })).toBe("Block 3");
    expect(programHeading({ name: "Block 3", label: null })).toBe("Block 3");
  });

  it("with nothing ready, falls back to the earliest unlock", () => {
    const { cards, fallback } = buildSessionStack([
      prog({ programId: "a", kind: "locked", unlocksOn: new Date("2026-10-10T00:00:00"), workoutId: "w1" }),
      prog({ programId: "b", kind: "locked", unlocksOn: new Date("2026-10-08T00:00:00"), workoutId: "w2" }),
    ]);
    expect(cards).toEqual([]);
    expect(fallback).toMatchObject({ status: "locked", workoutId: "w2" });
  });

  it("reports done when every program is finished, no-program when none have workouts", () => {
    expect(buildSessionStack([prog({ kind: "all_done", workoutId: null })]).fallback).toEqual({ status: "done" });
    expect(buildSessionStack([prog({ kind: "empty", workoutId: null })]).fallback).toEqual({ status: "no-program" });
    expect(buildSessionStack([]).fallback).toEqual({ status: "no-program" });
  });
});
