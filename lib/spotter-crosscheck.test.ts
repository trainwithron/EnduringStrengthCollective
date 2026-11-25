import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dayLabel,
  detectBiomechRedundancy,
  detectRedundancy,
  firstOfEach,
  isSingleJoint,
  pickSamePatternAlternative,
  sharedPattern,
  type BiomechTaggedEntry,
  type SpotterExerciseEntry,
} from "@/lib/programming-spotter";

// The Spotter and the builder cross-check each other (reports/spotter-builder-crosscheck-ORDER.md, Nov 24), Part 1: the noisy joint-action check.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Robyn's program, week 1, as it is in the database (program ab318fd3, built by the builder on Nov 24): day, slot, name, prime-mover tags, the coach's pattern and tier.
type Row = [day: number, slot: number, name: string, tags: string[], pattern: string | null, tier: "A" | "B" | "C" | null];
const ROBYN_WEEK_1: Row[] = [
  [1, 0, "Barbell Hip Thrust", ["hip_extension"], "Hinge", "A"],
  [1, 1, "Goblet Squat", ["hip_extension", "knee_extension"], "Squat", "B"],
  [1, 2, "Seated Cable Row", ["shoulder_extension", "scapula_retraction", "elbow_flexion"], "Horizontal Pull", "B"],
  [1, 3, "Single Leg Romanian Deadlift", ["hip_extension"], "Hinge", "B"],
  [1, 4, "Dumbbell Curl", ["elbow_flexion", "forearm_supination"], "Elbow Flexion (Biceps)", "B"],
  [1, 5, "Tricep Pushdown", ["elbow_extension"], null, null],
  [1, 6, "Plank", [], "Core: Stability", "B"],
  [1, 7, "Glute Bridge (Single Leg)", ["hip_extension"], null, null],
  [2, 0, "Hip Thrust", ["hip_extension"], "Hinge", "B"],
  [2, 1, "Dumbbell Romanian Deadlift", ["hip_extension"], "Hinge", "B"],
  [2, 2, "Bulgarian Split Squat", ["hip_extension", "knee_extension"], "Lunge", "A"],
  [2, 3, "Chest Supported Row", ["shoulder_extension", "scapula_retraction", "elbow_flexion"], "Horizontal Pull", "B"],
  [2, 4, "Cable Lat Pulldown", ["shoulder_adduction", "scapula_downward_rotation", "scapula_depression", "elbow_flexion"], "Vertical Pull", "B"],
  [2, 5, "Hammer Curl", ["elbow_flexion"], "Elbow Flexion (Biceps)", "C"],
  [2, 6, "Cable Overhead Tricep Extension (Vertical)", ["elbow_extension"], null, null],
  [2, 7, "Russian Twists", ["thoracic_rotation"], null, null],
  [3, 0, "GluteBuilder Hip Thrust", [], null, null],
  [3, 1, "Dumbbell Walking Lunge", ["hip_extension", "knee_extension"], "Lunge", "B"],
  [3, 2, "Bent Over Barbell Row", ["shoulder_extension", "scapula_retraction", "elbow_flexion"], "Horizontal Pull", "A"],
  [3, 3, "Rodgers Lat Pulldown", [], null, null],
  [3, 4, "EZ Bar Curl", ["elbow_flexion"], null, null],
  [3, 5, "Cable Tricep Pushdown (Rope)", ["elbow_extension"], null, null],
  [3, 6, "Cossack Squats", ["hip_extension", "hip_adduction", "knee_extension"], null, null],
  [3, 7, "Hollow Body Hold", [], "Core: Stability", "C"],
];

const biomech = (rows: Row[], weeks = 1): BiomechTaggedEntry[] =>
  Array.from({ length: weeks }, (_, w) => rows.map(([day, , name, tags]) => ({ exerciseName: name, weekNumber: w + 1, workoutId: `w${w + 1}d${day}`, dayIndex: day, primeMoverTagKeys: tags }))).flat();
const slots = (rows: Row[], perDay = true): SpotterExerciseEntry[] =>
  rows.map(([day, slot, name, , pattern, tier]) => ({ exerciseName: name, category: null, tier, movementPatternId: pattern, setCount: 3, slotIndex: slot, slotCountInSession: 8, weekNumber: 1, workoutId: perDay ? `d${day}` : null, dayIndex: perDay ? day : null }));
const patternsOf = (rows: Row[]) => new Map(rows.filter((r) => r[4]).map((r) => [r[2], [r[4] as string]]));

describe("Ron's real flags on Robyn's program do not come back", () => {
  const flags = detectBiomechRedundancy(biomech(ROBYN_WEEK_1));
  it("rows, pulldowns and curls are not all elbow flexion; rows are not shoulder extension work", () => {
    expect(flags.find((f) => f.tagKey === "elbow_flexion")).toBeUndefined();
    expect(flags.find((f) => f.tagKey === "shoulder_extension")).toBeUndefined();
  });
  it("one pushdown or overhead extension a day over three days is not tricep stacking", () => {
    expect(flags.find((f) => f.tagKey === "elbow_extension")).toBeUndefined();
  });
  it("Bulgarian Split Squat, Cossack, Walking Lunge and Goblet Squat spread over three full-body days are not knee extension stacking", () => {
    expect(flags.find((f) => f.tagKey === "knee_extension")).toBeUndefined();
  });
  it("what is left is the one real question: Day 1, the glute day, has three single-joint hip extension moves", () => {
    expect(flags).toEqual([{ tagKey: "hip_extension", weekNumber: 1, dayIndex: 1, exerciseNames: ["Barbell Hip Thrust", "Glute Bridge (Single Leg)", "Single Leg Romanian Deadlift"] }]);
  });
  it("the stacked back-to-back check is per day: Robyn's one row a day is never three rows in a row", () => {
    expect(detectRedundancy(slots(ROBYN_WEEK_1))).toEqual([]);
  });
  it("the same day in every week of a 4-week program is one note, with the other days counted", () => {
    const four = firstOfEach(detectBiomechRedundancy(biomech(ROBYN_WEEK_1, 4)), (f) => f.tagKey);
    expect(four).toHaveLength(1);
    expect(four[0]).toMatchObject({ flag: { weekNumber: 1, dayIndex: 1 }, moreDays: 3 });
  });
});

describe("true positives still flag", () => {
  it("three curl variations in one day", () => {
    const day: Row[] = [
      [2, 0, "Barbell Back Squat", ["hip_extension", "knee_extension"], "Squat", "A"],
      [2, 1, "Dumbbell Curl", ["elbow_flexion", "forearm_supination"], "Elbow Flexion (Biceps)", "B"],
      [2, 2, "Hammer Curl", ["elbow_flexion"], "Elbow Flexion (Biceps)", "C"],
      [2, 3, "EZ Bar Curl", ["elbow_flexion"], null, null],
    ];
    expect(detectBiomechRedundancy(biomech(day))).toEqual([{ tagKey: "elbow_flexion", weekNumber: 1, dayIndex: 2, exerciseNames: ["Dumbbell Curl", "EZ Bar Curl", "Hammer Curl"] }]);
  });
  it("three rows back to back in one day, with the day in the flag", () => {
    const day: Row[] = [
      [2, 0, "Bent Over Barbell Row", [], "Horizontal Pull", "A"],
      [2, 1, "Seated Cable Row", [], "Horizontal Pull", "B"],
      [2, 2, "Chest Supported Row", [], "Horizontal Pull", "B"],
    ];
    expect(detectRedundancy(slots(day))).toEqual([{ movementPatternId: "Horizontal Pull", weekNumber: 1, dayIndex: 2, exerciseNames: ["Bent Over Barbell Row", "Seated Cable Row", "Chest Supported Row"] }]);
    // the same three rows on three different days, at the same slot, were "back to back" when the whole week was one list
    const spread: Row[] = day.map(([, slot, ...rest], i) => [i + 1, 2, ...rest] as Row);
    expect(detectRedundancy(slots(spread))).toEqual([]);
  });
});

describe("single-joint or compound", () => {
  it("from the joints of the prime movers (the shoulder and shoulder blade are one, the elbow, forearm and wrist are one)", () => {
    expect(isSingleJoint({ primeMoverTagKeys: ["elbow_flexion", "forearm_supination"] })).toBe(true);
    expect(isSingleJoint({ primeMoverTagKeys: ["shoulder_abduction", "scapula_upward_rotation"] })).toBe(true);
    expect(isSingleJoint({ primeMoverTagKeys: ["hip_extension"] })).toBe(true);
    expect(isSingleJoint({ primeMoverTagKeys: ["shoulder_extension", "scapula_retraction", "elbow_flexion"] })).toBe(false);
    expect(isSingleJoint({ primeMoverTagKeys: ["shoulder_horizontal_adduction", "elbow_extension"] })).toBe(false);
    expect(isSingleJoint({ primeMoverTagKeys: ["hip_extension", "knee_extension"] })).toBe(false);
    expect(isSingleJoint({ primeMoverTagKeys: [] })).toBe(false);
  });
  it("biomech_tags.joint wins over the key when it is given", () => {
    expect(isSingleJoint({ primeMoverTagKeys: ["thoracic_rotation", "lumbar_rotation"], primeMoverJoints: ["spine_thoracic", "spine_lumbar"] })).toBe(true);
    expect(isSingleJoint({ primeMoverTagKeys: ["a_move", "b_move"], primeMoverJoints: ["elbow", "hip"] })).toBe(false);
  });
});

describe("the suggested swap is in the same movement pattern", () => {
  const candidates = [
    { name: "Ab Wheel Rollout", tier: "A" as const, patternIds: ["Core: Anti-Extension"] },
    { name: "Barbell Bench Press", tier: "A" as const, patternIds: ["Horizontal Push"] },
    { name: "Bent Over Barbell Row", tier: "A" as const, patternIds: ["Horizontal Pull"] },
    { name: "Barbell Curl", tier: "B" as const, patternIds: ["Elbow Flexion (Biceps)"] },
    { name: "Cable Curl", tier: "C" as const, patternIds: ["Elbow Flexion (Biceps)"] },
  ];
  it("curls get a curl, never a row", () => {
    const curls = ["Dumbbell Curl", "EZ Bar Curl", "Hammer Curl"];
    expect(pickSamePatternAlternative(curls, patternsOf(ROBYN_WEEK_1), candidates)).toBe("Barbell Curl");
  });
  it("rows get a row or nothing, never Ab Wheel Rollout", () => {
    const rows = ["Seated Cable Row", "Chest Supported Row", "Bent Over Barbell Row"];
    expect(pickSamePatternAlternative(rows, patternsOf(ROBYN_WEEK_1), candidates)).toBeNull(); // the only Horizontal Pull candidate is already one of them
    expect(pickSamePatternAlternative(rows, patternsOf(ROBYN_WEEK_1), [...candidates, { name: "T-Bar Row", tier: "B", patternIds: ["Horizontal Pull"] }])).toBe("T-Bar Row");
  });
  it("pushdowns with no pattern get no suggestion (never Barbell Bench Press): the headline just asks", () => {
    const pushdowns = ["Tricep Pushdown", "Cable Overhead Tricep Extension (Vertical)", "Cable Tricep Pushdown (Rope)"];
    expect(sharedPattern(pushdowns, patternsOf(ROBYN_WEEK_1))).toBeNull();
    expect(pickSamePatternAlternative(pushdowns, patternsOf(ROBYN_WEEK_1), candidates)).toBeNull();
  });
  it("one flagged exercise in a pattern is not enough to call it theirs", () => {
    expect(sharedPattern(["Dumbbell Curl", "EZ Bar Curl", "Tricep Pushdown"], patternsOf(ROBYN_WEEK_1))).toBeNull();
  });
});

describe("headlines say the day", () => {
  it("Day 2, or Week 3, Day 2 in a longer program", () => {
    expect(dayLabel({ weekNumber: 1, dayIndex: 2 }, false)).toBe("Day 2");
    expect(dayLabel({ weekNumber: 3, dayIndex: 2 }, true)).toBe("Week 3, Day 2");
    expect(dayLabel({ weekNumber: 3, dayIndex: null }, true)).toBe("Week 3");
  });
  it("the gather uses them, one note per thing, and the swap from the same pattern", () => {
    const g = read("lib/programming-spotter-gather.ts");
    expect(g).toContain('select("id, week_number, day_index")');
    expect(g).toContain("firstOfEach(detectRedundancy(entries), (r) => r.movementPatternId)");
    expect(g).toContain("firstOfEach(detectBiomechRedundancy(biomechEntries), (f) => f.tagKey)");
    expect(g).toContain("pickSamePatternAlternative(");
    expect(g).toContain("biomech_tags!inner ( key, joint )");
    expect(g).not.toContain("pickBestAlternative");
    expect(g.match(/`Week \$\{f\.weekNumber\}: \$\{(exerciseList|f\.exerciseNames)/g)).toBeNull();
  });
});
