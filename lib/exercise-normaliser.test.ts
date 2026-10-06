import { describe, it, expect } from "vitest";
import { canonicalKey, exerciseTokens, nameSimilarity, singular, suggestExercises, sureDuplicates } from "./exercise-normaliser";

describe("one exercise, however it is typed", () => {
  const same: [string, string][] = [
    ["Band Pull Apart", "Band Pull-Apart"],
    ["Farmer's Carry", "Farmers Carry"],
    ["Dips", "Dip"],
    ["Chin Ups", "Chin-Up"],
    ["Sit Ups", "Sit-Up"],
    ["Step Ups", "Step Up"],
    ["Walking Lunges", "Walking Lunge"],
    ["Bulgarian Split Squats", "Bulgarian Split Squat"],
    ["Dumbbell Lateral Raises", "Dumbbell Lateral Raise"],
    ["Lat Pull Down", "Lat Pulldown"],
    ["Shoulder CARS", "Shoulder CARs"],
    ["Cable Chest Flyes", "Cable Chest Fly"],
    ["DB Bench Press", "Dumbbell Bench Press"],
    ["RDL", "Romanian Deadlift"],
    ["Incline Dumbbell Bench Press", "Dumbbell Incline Bench Press"],
    ["The Plank Exercise", "Plank"],
  ];
  for (const [a, b] of same) {
    it(`${a} = ${b}`, () => {
      // "Lat Pull Down" and "Lat Pulldown" differ by a space: handled below as an explicit join rule.
      expect(canonicalKey(a)).toBe(canonicalKey(b));
    });
  }
});

describe("two movements that only share a word stay apart", () => {
  const apart: [string, string][] = [
    ["Reverse Lunge", "Walking Lunge"],
    ["Walking Lunge", "Lateral Lunge"],
    ["Back Squat", "Front Squat"],
    ["Bench Press", "Incline Bench Press"],
    ["Calf Raise", "Calf Raises (Straight Leg)"],
    ["Cable Tricep Pushdown (Rope)", "Cable Triceps Pushdown"],
    ["Hip Thrust", "Hip Thrust (Bodyweight)"],
    ["Deadlift", "Romanian Deadlift"],
    ["Face Pull", "Barbell Face Pull"],
    ["Barbell Row", "Dumbbell Row"],
    ["Pull-Up", "Chin-Up"],
  ];
  for (const [a, b] of apart) {
    it(`${a} is not ${b}`, () => {
      expect(canonicalKey(a)).not.toBe(canonicalKey(b));
    });
  }
});

describe("pieces", () => {
  it("makes plurals singular without breaking words that merely end in s", () => {
    expect(singular("lunges")).toBe("lunge");
    expect(singular("raises")).toBe("raise");
    expect(singular("presses")).toBe("press");
    expect(singular("press")).toBe("press");
    expect(singular("glutes")).toBe("glutes");
    expect(singular("crunches")).toBe("crunch");
    expect(singular("flyes")).toBe("fly");
    expect(singular("cars")).toBe("car");
  });
  it("spells out abbreviations and keeps words in brackets", () => {
    expect(exerciseTokens("DB RDL")).toEqual(["dumbbell", "romanian", "deadlift"]);
    expect(exerciseTokens("Cable Tricep Pushdown (Rope)")).toContain("rope");
  });
  it("scores overlap and suggests the closest names, never a name with the same key", () => {
    expect(nameSimilarity("Reverse Lunge", "Walking Lunge")).toBeCloseTo(1 / 3, 5);
    const known = ["Reverse Lunge", "Walking Lunge", "Barbell Row", "Dumbbell Walking Lunge"];
    const s = suggestExercises("walking lunges", known);
    expect(s.map((x) => x.name)).not.toContain("Walking Lunge"); // the same exercise, handled before suggesting
    expect(s[0].name).toBe("Dumbbell Walking Lunge");
    expect(suggestExercises("Walking Lunge", known).length).toBeLessThanOrEqual(3);
  });
  it("groups names that share a key", () => {
    expect(sureDuplicates(["Dips", "Dip", "Plank", "Sit Ups", "Sit-Up", "Step Up"])).toEqual([["Dips", "Dip"], ["Sit Ups", "Sit-Up"]]);
  });
});
