import { describe, it, expect } from "vitest";
import { generateGzclpProgram, type GzclpLiftInput } from "./gzclp-generator";

const squat: GzclpLiftInput = { exerciseName: "Back Squat", t1StartingWeight: 225, t2StartingWeight: 115 };
const bench: GzclpLiftInput = { exerciseName: "Bench Press", t1StartingWeight: 165, t2StartingWeight: 85 };
const ohp: GzclpLiftInput = { exerciseName: "Overhead Press", t1StartingWeight: 105, t2StartingWeight: 55 };
const deadlift: GzclpLiftInput = { exerciseName: "Deadlift", t1StartingWeight: 275, t2StartingWeight: 135 };

describe("generateGzclpProgram", () => {
  it("produces 4 days x 2 lifts per week (T1+T2, no accessory)", () => {
    const { rows } = generateGzclpProgram({ lifts: [squat, bench, ohp, deadlift], weeksToGenerate: 1 });
    expect(rows).toHaveLength(4 * 2);
  });

  it("pairs each lift as T1 on one day and T2 on another, per the canonical rotation", () => {
    const { rows } = generateGzclpProgram({ lifts: [squat, bench, ohp, deadlift], weeksToGenerate: 1 });
    const byDay = (day: string) => rows.filter((r) => r.day === day);

    expect(byDay("Day 1").map((r) => r.exerciseName)).toEqual(["Back Squat", "Bench Press"]);
    expect(byDay("Day 2").map((r) => r.exerciseName)).toEqual(["Overhead Press", "Deadlift"]);
    expect(byDay("Day 3").map((r) => r.exerciseName)).toEqual(["Bench Press", "Back Squat"]);
    expect(byDay("Day 4").map((r) => r.exerciseName)).toEqual(["Deadlift", "Overhead Press"]);
  });

  it("bakes real starting weights into week 1 only, leaving later weeks null for the dynamic engine", () => {
    const { rows } = generateGzclpProgram({ lifts: [squat, bench, ohp, deadlift], weeksToGenerate: 3 });
    const week1Squat = rows.find((r) => r.week === "1" && r.exerciseName === "Back Squat");
    const week2Squat = rows.find((r) => r.week === "2" && r.exerciseName === "Back Squat");
    expect(week1Squat?.weight).toBe(225);
    expect(week2Squat?.weight).toBeNull();
  });

  it("uses the real GZCLP T1 stage-1 scheme (5x3+) and T2's fixed 3x10", () => {
    const { rows } = generateGzclpProgram({ lifts: [squat, bench, ohp, deadlift], weeksToGenerate: 1 });
    const t1Row = rows.find((r) => r.exerciseName === "Back Squat" && r.day === "Day 1");
    const t2Row = rows.find((r) => r.exerciseName === "Bench Press" && r.day === "Day 1");
    expect(t1Row).toMatchObject({ sets: 5, reps: "5x3+" });
    expect(t2Row).toMatchObject({ sets: 3, reps: "10" });
  });

  it("gives every lift a T1 rule for its T1 days and a separate T2 rule for its T2 days", () => {
    const { progressionRules } = generateGzclpProgram({ lifts: [squat, bench, ohp, deadlift], weeksToGenerate: 1 });
    expect(progressionRules).toHaveLength(8);
    const t1 = progressionRules.filter((r) => r.slot === "T1");
    const t2 = progressionRules.filter((r) => r.slot === "T2");
    expect(t1.every((r) => r.model === "gzclp_t1" && r.tierLabel === "T1")).toBe(true);
    expect(t2.every((r) => r.model === "double_progression" && r.tierLabel === "T2")).toBe(true);
    const lifts = ["Back Squat", "Bench Press", "Deadlift", "Overhead Press"];
    expect(t1.map((r) => r.exerciseName).sort()).toEqual(lifts);
    expect(t2.map((r) => r.exerciseName).sort()).toEqual(lifts);
  });

  it("the T2 rule is GZCLP's fixed 3x10, adding the T2 increment once every set reaches 10", () => {
    const { progressionRules } = generateGzclpProgram({ lifts: [squat, bench, ohp, deadlift], weeksToGenerate: 1, t2WeightIncrement: 10 });
    const squatT2 = progressionRules.find((r) => r.exerciseName === "Back Squat" && r.slot === "T2");
    expect(squatT2?.config).toEqual({ repRangeLow: 10, repRangeHigh: 10, weightIncrement: 10, unit: "lbs" });
  });

  it("marks every row with its slot, so each day follows the rule for its role", () => {
    const { rows } = generateGzclpProgram({
      lifts: [squat, bench, ohp, deadlift],
      weeksToGenerate: 2,
      t3: [{ exerciseName: "Lat Pulldown", startingWeight: 100, dayIndex: 0 }],
    });
    const slotOf = (day: string, name: string) => rows.find((r) => r.week === "2" && r.day === day && r.exerciseName === name)?.progressionSlot;
    expect(slotOf("Day 1", "Back Squat")).toBe("T1");
    expect(slotOf("Day 3", "Back Squat")).toBe("T2");
    expect(slotOf("Day 1", "Lat Pulldown")).toBe("T3");
    expect(rows.every((r) => r.progressionSlot === "T1" || r.progressionSlot === "T2" || r.progressionSlot === "T3")).toBe(true);
  });

  it("seeds each T1 rule's config from the real starting weight, not a guess", () => {
    const { progressionRules } = generateGzclpProgram({ lifts: [squat, bench, ohp, deadlift], weeksToGenerate: 1 });
    const squatRule = progressionRules.find((r) => r.exerciseName === "Back Squat");
    expect(squatRule?.config).toMatchObject({ startingWeight: 225, weightIncrement: 5, deloadPercent: 10 });
  });

  it("adds a T3 accessory on its chosen day with its own double_progression rule", () => {
    const { rows, progressionRules } = generateGzclpProgram({
      lifts: [squat, bench, ohp, deadlift],
      weeksToGenerate: 1,
      t3: [{ exerciseName: "Lat Pulldown", startingWeight: 100, dayIndex: 0 }],
    });
    const day1Rows = rows.filter((r) => r.day === "Day 1");
    expect(day1Rows).toHaveLength(3);
    expect(day1Rows[2]).toMatchObject({ exerciseName: "Lat Pulldown", sets: 3, reps: "15+", weight: 100 });

    const t3Rule = progressionRules.find((r) => r.exerciseName === "Lat Pulldown");
    expect(t3Rule).toMatchObject({
      model: "double_progression",
      tierLabel: "T3",
      config: { repRangeLow: 15, repRangeHigh: 25 },
    });
    expect(t3Rule?.slot).toBe("T3");
    expect(progressionRules).toHaveLength(9); // 4 T1 rules + 4 T2 rules + 1 T3 accessory
  });
});
