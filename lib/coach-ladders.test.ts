import { describe, it, expect, vi } from "vitest";
import { coachLadders, loadCoachLadders, STARTER_LADDER_OWNER } from "./coach-ladders";
import { planTemplate, templateSummary } from "./make-template";

// Oct 26 review: every starter pattern (14 patterns, 136 rungs) is owned by the starter owner, not by Ron, who owns none. Reading only the coach's own patterns turned 0 exercises into slots for him.
const RON = "136394ed-f108-4283-bcb7-310a1ac6cbc8";
const OTHER = "35daeb9f-9abb-4160-a7d0-8c0871e9b5ad";
const patterns = [
  { id: "s-squat", name: "Squat", created_by: STARTER_LADDER_OWNER },
  { id: "s-hinge", name: "Hinge", created_by: STARTER_LADDER_OWNER },
  { id: "x-push", name: "Horizontal Push", created_by: OTHER },
];
const rungs = [
  { movement_pattern_id: "s-squat", exercise_name: "Goblet Squat", tier: "B", is_unilateral: false },
  { movement_pattern_id: "s-hinge", exercise_name: "Romanian Deadlift", tier: "A", is_unilateral: false },
  { movement_pattern_id: "x-push", exercise_name: "Bench Press", tier: "A", is_unilateral: false },
];

describe("the ladders a coach works from", () => {
  it("a coach with no patterns of their own gets the starter set (owned by another, seed account)", () => {
    const ladders = coachLadders(RON, patterns, rungs);
    expect(ladders.map((l) => `${l.patternName}:${l.exerciseName}`).sort()).toEqual(["Hinge:Romanian Deadlift", "Squat:Goblet Squat"]);
    // so Make a template makes slots for Ron
    const plan = planTemplate([{ id: "1", name: "Goblet Squat" }, { id: "2", name: "Romanian Deadlift" }, { id: "3", name: "Bench Press" }], ladders);
    expect(templateSummary(plan)).toBe("2 of 3 exercises became slots; Bench Press stayed as it is (not on a ladder yet).");
  });
  it("another coach's own patterns are never used", () => {
    expect(coachLadders(RON, patterns, rungs).some((l) => l.patternId === "x-push")).toBe(false);
  });
  it("the coach's own pattern wins over a starter one with the same name", () => {
    const mine = [...patterns, { id: "r-squat", name: "squat", created_by: RON }];
    const mineRungs = [...rungs, { movement_pattern_id: "r-squat", exercise_name: "Front Squat", tier: "A", is_unilateral: false }];
    const ladders = coachLadders(RON, mine, mineRungs);
    expect(ladders.filter((l) => l.patternName.toLowerCase() === "squat").map((l) => l.exerciseName)).toEqual(["Front Squat"]);
    expect(ladders.some((l) => l.patternId === "s-hinge")).toBe(true);
  });
  it("it reads the coach's and the starter owner's patterns, then their rungs; a failed read is said, never read as no ladders", async () => {
    const calls: { table: string; col: string; vals: unknown }[] = [];
    const db = {
      from: (table: string) => ({
        select: () => ({
          in: async (col: string, vals: unknown) => {
            calls.push({ table, col, vals });
            if (table === "movement_patterns") return { data: patterns, error: null };
            return { data: rungs, error: null };
          },
        }),
      }),
    };
    const r = await loadCoachLadders(db as never, RON);
    expect("ladders" in r && r.ladders.length).toBe(2);
    expect(calls[0]).toEqual({ table: "movement_patterns", col: "created_by", vals: [RON, STARTER_LADDER_OWNER] });
    expect(calls[1].table).toBe("movement_pattern_exercises");
    const failing = { from: () => ({ select: () => ({ in: vi.fn(async () => ({ data: null, error: { message: "x" } })) }) }) };
    expect(await loadCoachLadders(failing as never, RON)).toEqual({ error: true });
  });
});
