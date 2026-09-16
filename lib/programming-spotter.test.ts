import { describe, it, expect } from "vitest";
import {
  detectVolumeConcentration,
  detectRedundancy,
  detectFlatRepeat,
  detectMissingPatternCoverage,
  detectBiomechRedundancy,
  type SpotterExerciseEntry,
  type FlatRepeatEntry,
  type BiomechTaggedEntry,
} from "./programming-spotter";

function entry(overrides: Partial<SpotterExerciseEntry>): SpotterExerciseEntry {
  return {
    exerciseName: "Exercise",
    category: null,
    tier: null,
    movementPatternId: "pattern-1",
    setCount: 3,
    slotIndex: 0,
    slotCountInSession: 5,
    weekNumber: 1,
    ...overrides,
  };
}

describe("detectVolumeConcentration", () => {
  it("fires on Ron's real corrected example: 15 rear-delt sets late in a session, an outlier week", () => {
    // 5 rear-delt exercises x 3 sets = 15 sets, slots 2-6 of a 6-slot
    // session (late-session drift), week 3 is the only week this heavy.
    const lateSession: SpotterExerciseEntry[] = [1, 2, 3, 4, 5].map((i) =>
      entry({ exerciseName: `Rear Delt ${i}`, movementPatternId: "rear-delt", setCount: 3, slotIndex: i, slotCountInSession: 6, weekNumber: 3 })
    );
    const lightOtherWeeks: SpotterExerciseEntry[] = [1, 2].flatMap((week) => [
      entry({ exerciseName: "Rear Delt 1", movementPatternId: "rear-delt", setCount: 3, slotIndex: 4, slotCountInSession: 6, weekNumber: week }),
    ]);
    const flags = detectVolumeConcentration([...lateSession, ...lightOtherWeeks]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ movementPatternId: "rear-delt", weekNumber: 3, totalSets: 15 });
  });

  it("does not fire on early-session emphasis (deliberate priority, not accidental drift)", () => {
    const earlySession: SpotterExerciseEntry[] = [0, 1, 2, 3, 4].map((i) =>
      entry({ exerciseName: `Bench ${i}`, movementPatternId: "horizontal-push", setCount: 3, slotIndex: i, slotCountInSession: 6, weekNumber: 1 })
    );
    expect(detectVolumeConcentration(earlySession)).toEqual([]);
  });

  it("does not fire when the same concentration is consistent every week (a specialization block, not a slip)", () => {
    const weeks = [1, 2, 3, 4].flatMap((week) =>
      [1, 2, 3, 4, 5].map((i) =>
        entry({ exerciseName: `Rear Delt ${i}`, movementPatternId: "rear-delt", setCount: 3, slotIndex: i, slotCountInSession: 6, weekNumber: week })
      )
    );
    expect(detectVolumeConcentration(weeks)).toEqual([]);
  });

  it("excludes Mobility and Cardio categories from volume counting entirely", () => {
    const entries = [1, 2, 3, 4, 5].map((i) =>
      entry({
        exerciseName: `Mobility ${i}`,
        category: "Mobility",
        movementPatternId: "hip-mobility",
        setCount: 3,
        slotIndex: i,
        slotCountInSession: 6,
        weekNumber: 1,
      })
    );
    expect(detectVolumeConcentration(entries)).toEqual([]);
  });

  it("uses a lower threshold for tier-A primary work than tier-C assistance work", () => {
    const tierA = [1, 2].map((i) =>
      entry({ exerciseName: `Squat ${i}`, tier: "A", movementPatternId: "squat", setCount: 4, slotIndex: 3 + i, slotCountInSession: 6, weekNumber: 1 })
    ); // 8 sets total, tier A threshold is 8 -> fires
    const tierC = [1, 2].map((i) =>
      entry({ exerciseName: `Curl ${i}`, tier: "C", movementPatternId: "biceps", setCount: 4, slotIndex: 3 + i, slotCountInSession: 6, weekNumber: 1 })
    ); // 8 sets total, tier C threshold is 14 -> does not fire
    const flags = detectVolumeConcentration([...tierA, ...tierC]);
    expect(flags.map((f) => f.movementPatternId)).toEqual(["squat"]);
  });
});

describe("detectRedundancy", () => {
  it("flags 3+ back-to-back exercises sharing the same movement pattern", () => {
    const entries = [0, 1, 2].map((i) =>
      entry({ exerciseName: `Rear Delt ${i}`, movementPatternId: "rear-delt", slotIndex: i, weekNumber: 1 })
    );
    const flags = detectRedundancy(entries);
    expect(flags).toHaveLength(1);
    expect(flags[0].exerciseNames).toEqual(["Rear Delt 0", "Rear Delt 1", "Rear Delt 2"]);
  });

  it("does not flag 2 back-to-back exercises of the same pattern", () => {
    const entries = [0, 1].map((i) => entry({ movementPatternId: "rear-delt", slotIndex: i, weekNumber: 1 }));
    expect(detectRedundancy(entries)).toEqual([]);
  });

  it("does not flag a broken run interrupted by a different pattern", () => {
    const entries = [
      entry({ movementPatternId: "rear-delt", slotIndex: 0, weekNumber: 1 }),
      entry({ movementPatternId: "squat", slotIndex: 1, weekNumber: 1 }),
      entry({ movementPatternId: "rear-delt", slotIndex: 2, weekNumber: 1 }),
      entry({ movementPatternId: "rear-delt", slotIndex: 3, weekNumber: 1 }),
    ];
    expect(detectRedundancy(entries)).toEqual([]);
  });
});

describe("detectFlatRepeat", () => {
  function flatEntry(overrides: Partial<FlatRepeatEntry>): FlatRepeatEntry {
    return { exerciseName: "Bench Press", weekNumber: 1, targetsFingerprint: "5x5@185", hasProgressionModel: false, ...overrides };
  }

  it("flags an identical exercise repeated 4+ weeks with no progression model", () => {
    const entries = [1, 2, 3, 4].map((week) => flatEntry({ weekNumber: week }));
    const flags = detectFlatRepeat(entries);
    expect(flags).toEqual([{ exerciseName: "Bench Press", weekCount: 4, weeks: [1, 2, 3, 4] }]);
  });

  it("does not flag when a progression model is attached", () => {
    const entries = [1, 2, 3, 4].map((week) => flatEntry({ weekNumber: week, hasProgressionModel: true }));
    expect(detectFlatRepeat(entries)).toEqual([]);
  });

  it("does not flag fewer than 4 weeks", () => {
    const entries = [1, 2, 3].map((week) => flatEntry({ weekNumber: week }));
    expect(detectFlatRepeat(entries)).toEqual([]);
  });

  it("does not flag when the targets actually differ week to week (real progression)", () => {
    const entries = [1, 2, 3, 4].map((week) => flatEntry({ weekNumber: week, targetsFingerprint: `5x5@${180 + week}` }));
    expect(detectFlatRepeat(entries)).toEqual([]);
  });
});

describe("detectMissingPatternCoverage", () => {
  it("does not flag a narrow-theme program name missing an unrelated pattern", () => {
    expect(detectMissingPatternCoverage("Squatober", new Set(["Legs", "Core"]))).toEqual([]);
  });

  it("flags a missing pattern when the name makes a comprehensiveness claim it breaks", () => {
    const flags = detectMissingPatternCoverage("Six Week Full Body Beach Hypertrophy", new Set(["Push", "Pull"]));
    expect(flags).toEqual([{ category: "Legs" }]);
  });

  it("does not flag a comprehensiveness-claim name that actually covers everything", () => {
    expect(detectMissingPatternCoverage("Total Body Strength", new Set(["Push", "Pull", "Legs"]))).toEqual([]);
  });
});

function biomechEntry(overrides: Partial<BiomechTaggedEntry>): BiomechTaggedEntry {
  return {
    exerciseName: "Exercise",
    weekNumber: 1,
    primeMoverTagKeys: [],
    ...overrides,
  };
}

describe("detectBiomechRedundancy", () => {
  it("fires on Ron's own rotator-cuff example — 3 differently-named exercises sharing one tag, no adjacency", () => {
    const entries: BiomechTaggedEntry[] = [
      biomechEntry({ exerciseName: "Overhead Y-Raise", weekNumber: 2, primeMoverTagKeys: ["shoulder_external_rotation"] }),
      biomechEntry({ exerciseName: "Banded External Rotation", weekNumber: 2, primeMoverTagKeys: ["shoulder_external_rotation"] }),
      biomechEntry({ exerciseName: "DB External Rotation", weekNumber: 2, primeMoverTagKeys: ["shoulder_external_rotation"] }),
    ];
    const flags = detectBiomechRedundancy(entries);
    expect(flags).toEqual([
      {
        tagKey: "shoulder_external_rotation",
        weekNumber: 2,
        exerciseNames: ["Banded External Rotation", "DB External Rotation", "Overhead Y-Raise"],
      },
    ]);
  });

  it("stays quiet when only 2 exercises share the tag", () => {
    const entries: BiomechTaggedEntry[] = [
      biomechEntry({ exerciseName: "Overhead Y-Raise", primeMoverTagKeys: ["shoulder_external_rotation"] }),
      biomechEntry({ exerciseName: "Banded External Rotation", primeMoverTagKeys: ["shoulder_external_rotation"] }),
    ];
    expect(detectBiomechRedundancy(entries)).toEqual([]);
  });

  it("does not count the same exercise name twice toward the threshold", () => {
    const entries: BiomechTaggedEntry[] = [
      biomechEntry({ exerciseName: "Overhead Y-Raise", primeMoverTagKeys: ["shoulder_external_rotation"] }),
      biomechEntry({ exerciseName: "Overhead Y-Raise", primeMoverTagKeys: ["shoulder_external_rotation"] }),
      biomechEntry({ exerciseName: "Banded External Rotation", primeMoverTagKeys: ["shoulder_external_rotation"] }),
    ];
    expect(detectBiomechRedundancy(entries)).toEqual([]);
  });

  it("never groups across different weeks", () => {
    const entries: BiomechTaggedEntry[] = [
      biomechEntry({ exerciseName: "A", weekNumber: 1, primeMoverTagKeys: ["hip_extension"] }),
      biomechEntry({ exerciseName: "B", weekNumber: 2, primeMoverTagKeys: ["hip_extension"] }),
      biomechEntry({ exerciseName: "C", weekNumber: 3, primeMoverTagKeys: ["hip_extension"] }),
    ];
    expect(detectBiomechRedundancy(entries)).toEqual([]);
  });

  it("never groups exercises sharing only DIFFERENT tags", () => {
    const entries: BiomechTaggedEntry[] = [
      biomechEntry({ exerciseName: "A", primeMoverTagKeys: ["hip_extension"] }),
      biomechEntry({ exerciseName: "B", primeMoverTagKeys: ["hip_flexion"] }),
      biomechEntry({ exerciseName: "C", primeMoverTagKeys: ["knee_extension"] }),
    ];
    expect(detectBiomechRedundancy(entries)).toEqual([]);
  });

  it("flags independently per tag when 3+ exercises share each of two different tags", () => {
    const entries: BiomechTaggedEntry[] = [
      biomechEntry({ exerciseName: "A", primeMoverTagKeys: ["hip_extension"] }),
      biomechEntry({ exerciseName: "B", primeMoverTagKeys: ["hip_extension"] }),
      biomechEntry({ exerciseName: "C", primeMoverTagKeys: ["hip_extension"] }),
      biomechEntry({ exerciseName: "D", primeMoverTagKeys: ["knee_extension"] }),
      biomechEntry({ exerciseName: "E", primeMoverTagKeys: ["knee_extension"] }),
      biomechEntry({ exerciseName: "F", primeMoverTagKeys: ["knee_extension"] }),
    ];
    const flags = detectBiomechRedundancy(entries);
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.tagKey).sort()).toEqual(["hip_extension", "knee_extension"]);
  });

  it("counts an exercise with multiple prime-mover tags toward each tag's own group", () => {
    const entries: BiomechTaggedEntry[] = [
      biomechEntry({ exerciseName: "Compound Lift", primeMoverTagKeys: ["hip_extension", "knee_extension"] }),
      biomechEntry({ exerciseName: "B", primeMoverTagKeys: ["hip_extension"] }),
      biomechEntry({ exerciseName: "C", primeMoverTagKeys: ["hip_extension"] }),
    ];
    const flags = detectBiomechRedundancy(entries);
    expect(flags).toEqual([
      { tagKey: "hip_extension", weekNumber: 1, exerciseNames: ["B", "C", "Compound Lift"] },
    ]);
  });
});
